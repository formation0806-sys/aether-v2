#!/bin/bash
# AETHER Ollama Production Setup Script for Oracle Cloud Ampere A1 (HARDENED)
# Run this on a fresh Ubuntu 22.04 VM with sudo access.
#
# SECURITY HARDENING APPLIED:
#   - Basic auth on nginx (OLLAMA_AUTH_PASSWORD required)
#   - IP whitelist (optional, OLLAMA_ALLOWED_IPS)
#   - HTTPS enforcement (HTTP→HTTPS redirect)
#   - Ollama installer downloaded then verified before execution
#   - nginx rate limiting
#   - Fail2ban for brute-force protection
#   - UFW firewall
#   - Ollama bound to localhost only (never exposed directly)

set -euo pipefail

echo "=== AETHER Ollama Production Setup (Hardened) ==="

# --- Configuration via environment variables ---
: "${OLLAMA_AUTH_PASSWORD:?ERROR: OLLAMA_AUTH_PASSWORD must be set. Generate a strong password.}"
OLLAMA_ALLOWED_IPS="${OLLAMA_ALLOWED_IPS:-0.0.0.0/0}"
OLLAMA_DOMAIN="${OLLAMA_DOMAIN:-}"

if [[ -z "$OLLAMA_DOMAIN" ]]; then
    echo "WARNING: OLLAMA_DOMAIN not set. HTTPS via certbot will require manual step."
    ENABLE_HTTPS=false
else
    ENABLE_HTTPS=true
fi

echo "Domain: ${OLLAMA_DOMAIN:-<not set>}"
echo "Allowed IPs: $OLLAMA_ALLOWED_IPS"
echo ""

# 1. System update
echo "[1/10] Updating system..."
sudo apt-get update -y
sudo apt-get upgrade -y

# 2. Install Ollama (download, verify, then execute)
echo "[2/10] Downloading Ollama installer..."
INSTALL_SCRIPT=$(mktemp /tmp/ollama-install.XXXXXX.sh)
curl -fsSL -o "$INSTALL_SCRIPT" https://ollama.com/install.sh

echo "[2/10] Installer downloaded to: $INSTALL_SCRIPT"
echo "[2/10] SECURITY: Review the installer before execution:"
echo "  Content hash (sha256):"
sha256sum "$INSTALL_SCRIPT"
echo ""
echo "  First 20 lines:"
head -20 "$INSTALL_SCRIPT"
echo ""
read -rp "Review the installer above. Proceed with execution? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted. Installer saved at: $INSTALL_SCRIPT"
    exit 1
fi

echo "[2/10] Executing Ollama installer..."
sudo bash "$INSTALL_SCRIPT"
rm -f "$INSTALL_SCRIPT"

# Enable and start as systemd service
sudo systemctl enable ollama
sudo systemctl start ollama

# Verify Ollama is running
sleep 3
if ! systemctl is-active --quiet ollama; then
    echo "ERROR: Ollama failed to start"
    exit 1
fi

# Ensure Ollama is bound to localhost only (defense in depth)
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/bind-localhost.conf <<'EOF'
[Service]
Environment=OLLAMA_HOST=127.0.0.1:11434
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama
echo "[2/10] Ollama is running (bound to localhost only)."

# 3. Pull models (EMBEDDING-ONLY host: nomic-embed-text:latest is the only model)
echo "[3/10] Pulling nomic-embed-text:latest (this may take a few minutes)..."
ollama pull nomic-embed-text:latest

echo "Models loaded:"
ollama list

# 4. Test locally
echo "[4/10] Testing the embedding endpoint locally..."
curl -s http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text:latest","input":"embedding smoke test","keep_alive":"5m"}' \
  | python3 -c 'import json,sys,math; v=json.load(sys.stdin)["embeddings"][0]; print("dimension=%d finite=%s non_zero=%s non_constant=%s" % (len(v), all(math.isfinite(x) for x in v), any(x!=0 for x in v), len(set(v))>1))'
echo ""

# 5. Install nginx + security tools
echo "[5/10] Installing nginx, certbot, and security tools..."
sudo apt-get install -y nginx certbot python3-certbot-nginx fail2ban apache2-utils

# 6. Create basic auth password file
echo "[6/10] Configuring basic auth..."
printf '%s\n' "$OLLAMA_AUTH_PASSWORD" | sudo htpasswd -c -i /etc/nginx/.ollama_passwd aether
sudo chmod 640 /etc/nginx/.ollama_passwd
sudo chown root:www-data /etc/nginx/.ollama_passwd

# 7. Configure nginx reverse proxy with security hardening
echo "[7/10] Configuring nginx with security hardening..."

# Build the allow/deny block
ALLOW_BLOCK=""
if [[ "$OLLAMA_ALLOWED_IPS" != "0.0.0.0/0" ]]; then
    IFS=',' read -ra IPS <<< "$OLLAMA_ALLOWED_IPS"
    for ip in "${IPS[@]}"; do
        ip=$(echo "$ip" | xargs)  # trim whitespace
        ALLOW_BLOCK="${ALLOW_BLOCK}        allow ${ip};"$'\n'
    done
    ALLOW_BLOCK="${ALLOW_BLOCK}        deny all;"$'\n'
fi

# --- TLS bootstrap ------------------------------------------------------
# The hardened configuration below references
# /etc/letsencrypt/live/__DOMAIN__/*.pem, which do not exist until certbot has
# run. Serving a temporary HTTP-only site first lets certbot complete the
# HTTP-01 challenge, so the hardened config is only ever activated against a
# certificate that already exists. nginx -t below is deliberately fatal.
if [[ "$ENABLE_HTTPS" == true ]]; then
    sudo tee /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'
server {
    listen 80;
    server_name __DOMAIN__;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 404;
    }
}
NGINX_CONFIG

    sudo sed -i "s/__DOMAIN__/$OLLAMA_DOMAIN/g" /etc/nginx/sites-available/ollama
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo ln -sf /etc/nginx/sites-available/ollama /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx

    echo "[7/10] Bootstrap HTTP site live; requesting certificate..."
    sudo certbot --nginx -d "$OLLAMA_DOMAIN"
    echo "[7/10] Certificate issued; installing hardened HTTPS configuration..."
fi

# Write nginx config using a quoted heredoc (no bash variable expansion of $nginx_vars)
# __DOMAIN__ placeholder is replaced with sed afterward
sudo tee /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'
# Rate limiting zone
limit_req_zone $binary_remote_addr zone=ollama_limit:10m rate=10r/s;

# Upstream
upstream ollama_backend {
    server 127.0.0.1:11434;
    keepalive 16;
}
NGINX_CONFIG

if [[ "$ENABLE_HTTPS" == true ]]; then
    # HTTP server: redirect to HTTPS
    sudo tee -a /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'
server {
    listen 80;
    server_name __DOMAIN__;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGINX_CONFIG

    # HTTPS server
    sudo tee -a /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'
server {
    listen 443 ssl http2;
    server_name __DOMAIN__;

    ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000" always;

    client_max_body_size 50m;

    location / {
        limit_req zone=ollama_limit burst=20 nodelay;
NGINX_CONFIG

    if [[ -n "$ALLOW_BLOCK" ]]; then
        echo "$ALLOW_BLOCK" | sudo tee -a /etc/nginx/sites-available/ollama > /dev/null
    fi

    sudo tee -a /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'

        auth_basic "AETHER Ollama";
        auth_basic_user_file /etc/nginx/.ollama_passwd;

        proxy_pass http://ollama_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX_CONFIG
else
    # No domain: HTTP-only with auth
    sudo tee -a /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'
server {
    listen 80;
    server_name _;

    location / {
        limit_req zone=ollama_limit burst=20 nodelay;
NGINX_CONFIG

    if [[ -n "$ALLOW_BLOCK" ]]; then
        echo "$ALLOW_BLOCK" | sudo tee -a /etc/nginx/sites-available/ollama > /dev/null
    fi

    sudo tee -a /etc/nginx/sites-available/ollama > /dev/null <<'NGINX_CONFIG'

        auth_basic "AETHER Ollama";
        auth_basic_user_file /etc/nginx/.ollama_passwd;

        proxy_pass http://ollama_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX_CONFIG
fi

# Replace __DOMAIN__ placeholder with actual domain
if [[ -n "$OLLAMA_DOMAIN" ]]; then
    sudo sed -i "s/__DOMAIN__/$OLLAMA_DOMAIN/g" /etc/nginx/sites-available/ollama
fi

# Remove default site and enable ours
sudo ln -sf /etc/nginx/sites-available/ollama /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 8. Configure fail2ban for nginx
echo "[8/10] Configuring fail2ban..."
sudo tee /etc/fail2ban/jail.local <<'F2B'
[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
findtime = 600

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10
bantime = 7200
findtime = 600
F2B

sudo systemctl enable fail2ban
sudo systemctl restart fail2ban

# 9. Configure UFW firewall (defense in depth alongside Oracle Security List)
echo "[9/10] Configuring UFW firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
if [[ "$ENABLE_HTTPS" == true ]]; then
    sudo ufw allow 443/tcp
    sudo ufw allow 80/tcp
else
    sudo ufw allow 80/tcp
fi
sudo ufw --force enable

# 10. Configure log rotation for Ollama logs
echo "[10/10] Configuring log rotation..."
sudo tee /etc/logrotate.d/ollama <<'LOGROTATE'
/var/log/ollama/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    copytruncate
}
LOGROTATE

echo ""
echo "=== Setup Complete (Hardened) ==="
echo ""
echo "SECURITY SUMMARY:"
echo "  - Ollama bound to: 127.0.0.1:11434 (not publicly accessible)"
echo "  - nginx auth: HTTP basic auth enabled (user: aether)"
echo "  - Rate limiting: 10 req/s per IP"
echo "  - Fail2ban: brute-force protection active"
echo "  - UFW firewall: only ports 80/443 (and SSH) open"
echo "  - HTTPS: $([ "$ENABLE_HTTPS" == true ] && echo "enabled via Let's Encrypt" || echo "HTTP-ONLY — run certbot manually for HTTPS")"
echo ""
echo "NEXT STEPS:"
if [[ "$ENABLE_HTTPS" == true ]]; then
    echo "  1. Ensure DNS points ${OLLAMA_DOMAIN} to this VM's public IP (must resolve BEFORE running this script)"
    echo "  2. The TLS certificate was obtained automatically during setup."
    echo "  3. Verify automated renewal: sudo certbot renew --dry-run"
else
    echo "  WARNING: Running without HTTPS. Data transmitted in plaintext."
    echo "  To enable HTTPS, set OLLAMA_DOMAIN and rerun, or run:"
    echo "     sudo certbot --nginx -d <your-domain>"
fi
echo ""
echo "  Test with authentication (embedding endpoint):"
echo "     curl -u aether:<PASSWORD> https://${OLLAMA_DOMAIN:-<IP>}/api/embed -d '{\"model\":\"nomic-embed-text:latest\",\"input\":\"test\"}'"
echo ""
echo "  Set Vercel environment variables (embed transport only):"
echo "     OLLAMA_EMBED_BASE_URL=https://${OLLAMA_DOMAIN:-<IP>}"
echo "     OLLAMA_EMBED_AUTH=Basic <base64(aether:<password>)>"
echo ""
echo "  NOTE: Salpa reads ONE complete Authorization value via OLLAMA_EMBED_AUTH."
echo "  OLLAMA_AUTH_USER / OLLAMA_AUTH_PASSWORD are NOT consumed by Salpa and yield 401."
echo "  Generate the value on the VM (no secret echoed, root-only file):"
echo "     umask 077; printf 'aether:%s' \"\$OLLAMA_AUTH_PASSWORD\" | base64 -w0 > /root/.ollama-embed-auth"
echo ""
echo "PUBLIC IP:"
curl -s ifconfig.me
echo ""
