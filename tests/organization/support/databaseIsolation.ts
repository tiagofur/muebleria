/** Fail closed on direct organization Playwright fixture connections. */
export function assertOrganizationTestDatabaseURL(rawURL: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    throw new Error('Invalid ORGANIZATION_TEST_DATABASE_URL');
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const allowedNames = ['granete_gate', 'granete_test', 'muebles_multiorg_test', 'muebles_pilot_readiness'];
  const allowedPrefixes = ['granete_gate_', 'granete_test_', 'muebles_multiorg_test_', 'muebles_pilot_'];
  const allowedName = allowedNames.includes(dbName) || allowedPrefixes.some(prefix => dbName.startsWith(prefix));
  const port = Number(parsed.port);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1'
    || !Number.isInteger(port) || port < 1 || port > 65535 || port === 5445
    || !parsed.username || !parsed.password
    || !allowedName || dbName.includes('prod')) {
    throw new Error('Unsafe ORGANIZATION_TEST_DATABASE_URL target');
  }

  for (const key of parsed.searchParams.keys()) {
    if (['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'servicefile'].includes(key.toLowerCase())) {
      throw new Error('ORGANIZATION_TEST_DATABASE_URL cannot override its target');
    }
  }
}
