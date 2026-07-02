import adapter from '@sveltejs/adapter-static';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'spotify-history-explorer';
const configuredBase = process.env.PUBLIC_BASE_PATH;
const productionBase = configuredBase === '/' ? '' : (configuredBase ?? `/${repoName}`);

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      strict: true
    }),
    paths: {
      base: process.env.NODE_ENV === 'production' ? productionBase : ''
    }
  }
};

export default config;
