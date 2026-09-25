const version = '1.0.0';
const internalBuildNumber = 23;
const releaseChannel = 'release';
const slug = 'examplemanaged';

// Update this to your Cloudflare Worker URL
const serverUrl = process.env.EXPO_UPDATES_SERVER_URL || 'https://your-worker.your-subdomain.workers.dev';

export default ({ config }) => {
  const configOverrides = {
    slug,
    version,
    runtimeVersion: `${version}.${internalBuildNumber}`,
    updates: {
      enabled: true,
      url: `${serverUrl}/api/manifest?project=${slug}&channel=${releaseChannel}`,
      checkAutomatically: 'ON_ERROR_RECOVERY',
      fallbackToCacheTimeout: 0,
      codeSigningCertificate: "./code-signing/certificate.pem",
      codeSigningMetadata: {
        keyid: 'main',
        alg: 'rsa-v1_5-sha256',
      },
    },
    ios: {
      buildNumber: `${internalBuildNumber}`,
      bundleIdentifier: `com.${slug}`,
    },
    android: {
      versionCode: internalBuildNumber,
      package: `com.${slug}`,
    },
  };

  return {
    ...config,
    ...configOverrides,
  };
};
