const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function substitute(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
}

export function findUnsubstitutedTokens(rendered: string): string[] {
  const tokens: string[] = [];
  for (const match of rendered.matchAll(PLACEHOLDER)) {
    tokens.push(match[1]);
  }
  return tokens;
}
