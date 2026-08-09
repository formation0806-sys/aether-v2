export type IdentityFact = {
  field: string;
  value: string;
};

export function extractIdentity(message: string): IdentityFact[] {
  const facts: IdentityFact[] = [];

  const text = message.trim();

  const name =
    text.match(/my name is\s+(.+)/i) ||
    text.match(/i am\s+([a-zA-Z ]+)$/i);

  if (name) {
    facts.push({
      field: "name",
      value: name[1].trim(),
    });
  }

  const age = text.match(/i(?:'m| am)\s+(\d{1,3})/i);

  if (age) {
    facts.push({
      field: "age",
      value: age[1],
    });
  }

  const profession =
    text.match(/i(?:'m| am)\s+a[n]?\s+(.+)/i) ||
    text.match(/i work as\s+(.+)/i);

  if (profession) {
    facts.push({
      field: "profession",
      value: profession[1].trim(),
    });
  }

  const favoriteLanguage =
    text.match(/favorite language is\s+(.+)/i);

  if (favoriteLanguage) {
    facts.push({
      field: "favorite_language",
      value: favoriteLanguage[1].trim(),
    });
  }

  const dog =
    text.match(/my dog(?:'s)? name is\s+(.+)/i);

  if (dog) {
    facts.push({
      field: "dog_name",
      value: dog[1].trim(),
    });
  }

  return facts;
}