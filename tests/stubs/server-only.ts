// Test shim: the real `server-only` package throws unless bundled with the
// react-server condition. Under vitest (plain node) we alias it to this empty
// module so server modules can be unit/integration-tested directly.
export {};
