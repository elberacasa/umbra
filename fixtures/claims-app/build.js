// Simulates a broken build: the README claims "the build passes cleanly".
process.stderr.write('build failed: missing generated schema\n');
process.exit(1);
