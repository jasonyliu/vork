export function log(component: string, message: string, fields?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    component,
    message,
    ...fields
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}
