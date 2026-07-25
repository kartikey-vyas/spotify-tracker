import { DEV_ROUTE_DIRS, stripDevRoutes } from './lib/dev-routes';

async function main(): Promise<void> {
  const buildDir = process.argv[2] ?? 'build';
  await stripDevRoutes(buildDir);
  console.log(`Stripped dev routes from ${buildDir}: ${DEV_ROUTE_DIRS.join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
