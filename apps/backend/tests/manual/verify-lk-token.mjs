// Manual L2H verification: confirm that a Livekit token signed by our backend
// is accepted by the official livekit-server-sdk TokenVerifier (the same
// verification path Livekit Server itself uses).
// Run: LK_TOKEN=$(./get-lk-token.sh) node tests/manual/verify-lk-token.mjs

import { TokenVerifier } from 'livekit-server-sdk';

const token = process.env.LK_TOKEN;
if (!token) {
  console.error('LK_TOKEN env var required');
  process.exit(2);
}

const v = new TokenVerifier('devkey', 'devsecret');
const claims = await v.verify(token);
console.log('✅ Token verified by Livekit server SDK');
console.log('   identity:', claims.sub);
console.log('   issuer:  ', claims.iss);
console.log('   exp:     ', new Date(claims.exp * 1000).toISOString());
console.log('   grants:  ', JSON.stringify(claims.video));
