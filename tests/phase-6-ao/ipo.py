from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.chart import PieChart, BarChart, Reference

wb = Workbook()
ws = wb.active
ws.title = "IPO Tracker"
tx = wb.create_sheet("Transactions")
dash = wb.create_sheet("Dashboard")

# Colors/styles
header_fill = PatternFill("solid", fgColor="1F4E78")
sub_fill = PatternFill("solid", fgColor="D9EAF7")
green_fill = PatternFill("solid", fgColor="E2F0D9")
yellow_fill = PatternFill("solid", fgColor="FFF2CC")
thin = Side(style="thin", color="B7B7B7")

headers = [
    "IPO Name","IPO Type","Open Date","Close Date","Listing Date",
    "Issue Price","Lot Size","Lots Applied","Shares Applied","Application Amount",
    "Application Date","Allotment Status","Shares Allotted","Amount Debited",
    "Listing Price","Listing P/L","Listing Return %","Current Price",
    "Current Value","Unrealized P/L","Unrealized Return %","Sold?","Sell Price",
    "Sell Date","Realized P/L","Total P/L","Total Return %","Notes"
]

for col, h in enumerate(headers, 1):
    c = ws.cell(1, col, h)
    c.fill = header_fill
    c.font = Font(color="FFFFFF", bold=True)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = Border(bottom=thin)

# formulas and formatting for 200 rows
for r in range(2, 202):
    ws.cell(r, 9, f'=IFERROR(G{r}*H{r},"")') # shares applied
    ws.cell(r,10, f'=IFERROR(F{r}*I{r},"")') # application amount
    ws.cell(r,14, f'=IFERROR(F{r}*M{r},"")') # amount debited
    ws.cell(r,16, f'=IF(OR(M{r}="",F{r}="",O{r}=""),"", (O{r}-F{r})*M{r})')
    ws.cell(r,17, f'=IFERROR((O{r}-F{r})/F{r},"")')
    ws.cell(r,19, f'=IF(OR(M{r}="",R{r}=""),"",M{r}*R{r})')
    ws.cell(r,20, f'=IF(OR(S{r}="",N{r}=""),"",S{r}-N{r})')
    ws.cell(r,21, f'=IFERROR(T{r}/N{r},"")')
    ws.cell(r,25, f'=IF(OR(V{r}<>"Yes",W{r}="",M{r}="",F{r}=""),"", (W{r}-F{r})*M{r})')
    ws.cell(r,26, f'=IF(V{r}="Yes",Y{r},T{r})')
    ws.cell(r,27, f'=IFERROR(Z{r}/N{r},"")')
    for c in range(1,29):
        ws.cell(r,c).border = Border(bottom=thin)

# dropdowns
ipo_type = DataValidation(type="list", formula1='"Mainboard,SME"', allow_blank=True)
allot = DataValidation(type="list", formula1='"Pending,Allotted,Not Allotted"', allow_blank=True)
sold = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True)
ws.add_data_validation(ipo_type); ipo_type.add("B2:B201")
ws.add_data_validation(allot); allot.add("L2:L201")
ws.add_data_validation(sold); sold.add("V2:V201")

# widths
widths = [22,12,13,13,13,12,10,12,14,18,15,18,15,16,13,14,16,14,15,16,18,10,12,13,14,13,15,25]
for i,w in enumerate(widths,1):
    ws.column_dimensions[chr(64+i) if i<=26 else ("AA" if i==27 else "AB")].width = w

ws.freeze_panes = "A2"
ws.auto_filter.ref = "A1:AB201"
for r in range(2,202):
    for c in [3,4,5,11,24]:
        ws.cell(r,c).number_format = "dd-mmm-yyyy"
    for c in [6,10,14,15,16,18,19,20,23,25,26]:
        ws.cell(r,c).number_format = '₹#,##0.00;[Red]-₹#,##0.00'
    for c in [17,21,27]:
        ws.cell(r,c).number_format = '0.00%;[Red]-0.00%'

ws.conditional_formatting.add("P2:P201", ColorScaleRule(start_type='min', start_color='F8696B',
                                                          mid_type='percentile', mid_value=50, mid_color='FFEB84',
                                                          end_type='max', end_color='63BE7B'))
ws.conditional_formatting.add("Z2:Z201", ColorScaleRule(start_type='min', start_color='F8696B',
                                                          mid_type='percentile', mid_value=50, mid_color='FFEB84',
                                                          end_type='max', end_color='63BE7B'))

# Transactions
tx_headers = ["Date","IPO Name","Transaction Type","Amount","Price per Share","Shares","Notes"]
for c,h in enumerate(tx_headers,1):
    cell=tx.cell(1,c,h); cell.fill=header_fill; cell.font=Font(color="FFFFFF",bold=True)
    cell.alignment=Alignment(horizontal="center")
for r in range(2,502):
    tx.cell(r,1).number_format="dd-mmm-yyyy"
    tx.cell(r,4).number_format='₹#,##0.00'
    tx.cell(r,5).number_format='₹#,##0.00'
dv_tx=DataValidation(type="list",formula1='"Application,Refund,Allotment Debit,Sell,Other"',allow_blank=True)
tx.add_data_validation(dv_tx); dv_tx.add("C2:C501")
tx.freeze_panes="A2"; tx.auto_filter.ref="A1:G501"
for col,w in {"A":14,"B":24,"C":20,"D":15,"E":18,"F":10,"G":30}.items():
    tx.column_dimensions[col].width=w

# Dashboard
dash.merge_cells("A1:F1")
dash["A1"]="IPO INVESTMENT DASHBOARD"
dash["A1"].fill=header_fill; dash["A1"].font=Font(color="FFFFFF",bold=True,size=18)
dash["A1"].alignment=Alignment(horizontal="center")

metrics = [
    ("Total IPOs Applied",'=COUNTA(\'IPO Tracker\'!A2:A201)'),
    ("Total Allotted",'=COUNTIF(\'IPO Tracker\'!L2:L201,"Allotted")'),
    ("Total Not Allotted",'=COUNTIF(\'IPO Tracker\'!L2:L201,"Not Allotted")'),
    ("Pending",'=COUNTIF(\'IPO Tracker\'!L2:L201,"Pending")'),
    ("Total Amount Applied",'=SUM(\'IPO Tracker\'!J2:J201)'),
    ("Total Amount Invested",'=SUM(\'IPO Tracker\'!N2:N201)'),
    ("Current Portfolio Value",'=SUMIFS(\'IPO Tracker\'!S2:S201,\'IPO Tracker\'!V2:V201,"No")'),
    ("Unrealized P/L",'=SUMIFS(\'IPO Tracker\'!T2:T201,\'IPO Tracker\'!V2:V201,"No")'),
    ("Realized P/L",'=SUM(\'IPO Tracker\'!Y2:Y201)'),
    ("Overall P/L",'=SUM(\'IPO Tracker\'!Z2:Z201)'),
    ("Overall Return %",'=IFERROR(B13/B7,0)')
]
for i,(label,formula) in enumerate(metrics,3):
    dash.cell(i,1,label).fill=sub_fill
    dash.cell(i,1).font=Font(bold=True)
    dash.cell(i,2,formula)
    dash.cell(i,2).fill=green_fill if i>=7 else yellow_fill

for r in range(7,13):
    dash.cell(r,2).number_format='₹#,##0.00;[Red]-₹#,##0.00'
dash["B13"].number_format='0.00%;[Red]-0.00%'

dash["D3"]="Allotment Status"
dash["E3"]="Count"
for cell in dash[3][3:5]:
    cell.fill=header_fill; cell.font=Font(color="FFFFFF",bold=True)
dash["D4"]="Allotted"; dash["E4"]='=COUNTIF(\'IPO Tracker\'!L2:L201,"Allotted")'
dash["D5"]="Not Allotted"; dash["E5"]='=COUNTIF(\'IPO Tracker\'!L2:L201,"Not Allotted")'
dash["D6"]="Pending"; dash["E6"]='=COUNTIF(\'IPO Tracker\'!L2:L201,"Pending")'

pie=PieChart()
pie.title="IPO Allotment Status"
pie.add_data(Reference(dash,min_col=5,min_row=3,max_row=6),titles_from_data=True)
pie.set_categories(Reference(dash,min_col=4,min_row=4,max_row=6))
dash.add_chart(pie,"D8")

dash["D22"]="Performance"
dash["E22"]="Amount"
for cell in dash[22][3:5]:
    cell.fill=header_fill; cell.font=Font(color="FFFFFF",bold=True)
dash["D23"]="Realized P/L"; dash["E23"]="=B11"
dash["D24"]="Unrealized P/L"; dash["E24"]="=B10"
bar=BarChart()
bar.title="IPO Profit / Loss"
bar.add_data(Reference(dash,min_col=5,min_row=22,max_row=24),titles_from_data=True)
bar.set_categories(Reference(dash,min_col=4,min_row=23,max_row=24))
dash.add_chart(bar,"D26")

for col,w in {"A":28,"B":20,"C":4,"D":22,"E":18,"F":4}.items():
    dash.column_dimensions[col].width=w

dash.freeze_panes="A3"

# Example row
example = ["Example IPO","Mainboard",None,None,None,100,100,1,None,None,None,"Pending",0,None,None,None,None,None,None,None,None,"No",None,None,None,None,None,"Replace this row with your IPO"]
for c,v in enumerate(example,1):
    if v is not None:
        ws.cell(2,c,v)

# Sheet tab colors
ws.sheet_properties.tabColor="1F4E78"
tx.sheet_properties.tabColor="70AD47"
dash.sheet_properties.tabColor="ED7D31"

# Instructions sheet
ins = wb.create_sheet("How to Use")
ins.column_dimensions["A"].width=110
instructions = [
    ("HOW TO USE YOUR IPO TRACKER", True),
    ("1. Add every IPO application in the IPO Tracker sheet. Fill the input columns; calculated columns update automatically.", False),
    ("2. Use dropdowns for IPO Type, Allotment Status, and Sold?.", False),
    ("3. When allotted, enter Shares Allotted and the Listing Price/Current Price.", False),
    ("4. If you sell the shares, select Sold = Yes and enter Sell Price and Sell Date.", False),
    ("5. Dashboard updates automatically from the tracker data.", False),
    ("6. Use Transactions sheet if you want a detailed record of applications, refunds, debits, and sales.", False),
    ("TIP: Keep one row per IPO application. The workbook is prepared for 200 IPO records.", False),
]
for i,(text,title) in enumerate(instructions,1):
    ins.cell(i,1,text)
    ins.cell(i,1).alignment=Alignment(wrap_text=True, vertical="top")
    if title:
        ins.cell(i,1).fill=header_fill
        ins.cell(i,1).font=Font(color="FFFFFF",bold=True,size=16)
    else:
        ins.cell(i,1).font=Font(size=12)
    ins.row_dimensions[i].height=28 if not title else 35

path="/mnt/data/IPO_Tracker_Dashboard.xlsx"
wb.save(path)
path