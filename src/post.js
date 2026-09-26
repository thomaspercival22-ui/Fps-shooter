// HDR post-processing: the scene renders into a floating-point target, then
// a bloom chain and a single composite pass apply filmic tone mapping,
// colour grading, lens effects and the vision modes (night vision, thermal,
// FPV drone analog video).
import * as THREE from 'three';

export const MODE = { normal: 0, nvg: 1, thermal: 2, fpv: 3, scope: 4 };

// Sun shadow camera: a 76 m square that follows the player, 1..220 m deep.
export const SHADOW = { half: 38, near: 1, far: 220 };

// ---------- contact-hardening sun shadows (PCSS) ----------
// Replaces three's soft PCF filter: a blocker search estimates how far the
// shadow caster is from the receiver, and the filter widens with that
// distance like a real sun (0.53 degrees wide, plus some sky scatter), so
// shadows are crisp where objects touch the ground and soften further away.
{
  const disk = [];
  for (let i = 0; i < 24; i++) {
    const r = Math.sqrt((i + 0.5) / 24), a = i * 2.39996323;
    disk.push(`vec2(${(Math.cos(a) * r).toFixed(5)}, ${(Math.sin(a) * r).toFixed(5)})`);
  }
  const PCSS = `
  #define PCSS_WIDTH ${(SHADOW.half * 2).toFixed(1)}
  #define PCSS_RANGE ${(SHADOW.far - SHADOW.near).toFixed(1)}
  #define PCSS_LIGHT 0.014
  const vec2 PCSS_DISK[24] = vec2[]( ${disk.join(', ')} );
  float pcssShadow( sampler2D map, vec2 mapSize, vec3 c ) {
    float ang = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
    mat2 rot = mat2( cos( ang ), sin( ang ), -sin( ang ), cos( ang ) );
    float texel = 1.0 / mapSize.x;
    float searchR = max( PCSS_LIGHT * 9.0 / PCSS_WIDTH, 3.0 * texel );
    float sum = 0.0, n = 0.0;
    for ( int i = 0; i < 12; i ++ ) {
      float d = unpackRGBAToDepth( texture2D( map, c.xy + rot * PCSS_DISK[ i * 2 ] * searchR ) );
      if ( d < c.z ) { sum += d; n += 1.0; }
    }
    if ( n < 0.5 ) return 1.0;
    float dist = ( c.z - sum / n ) * PCSS_RANGE;
    float r = clamp( dist * PCSS_LIGHT / PCSS_WIDTH, 1.25 * texel, searchR );
    float lit = 0.0;
    for ( int i = 0; i < 24; i ++ ) lit += texture2DCompare( map, c.xy + rot * PCSS_DISK[ i ] * r, c.z );
    return lit / 24.0;
  }
`;
  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  chunk = chunk.replace('float getShadow(', PCSS + '\n\tfloat getShadow(');
  chunk = chunk.replace('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )',
    '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )\n\t\t\tshadow = pcssShadow( shadowMap, shadowMapSize, shadowCoord.xyz );\n\t\t#elif defined( PCF_SOFT_UNUSED )');
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk;
}

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
uniform sampler2D tSrc; uniform float threshold; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-0.5,-0.5)).rgb + texture2D(tSrc, vUv + texel * vec2(0.5,-0.5)).rgb
         + texture2D(tSrc, vUv + texel * vec2(-0.5,0.5)).rgb + texture2D(tSrc, vUv + texel * vec2(0.5,0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - threshold * 0.5, 0.0, threshold);
  soft = soft * soft / (4.0 * threshold + 1e-4);
  float k = max(soft, l - threshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

// dual-filter (Kawase) down / up sampling
const DOWN = `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0,1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const UP = `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}`;

// ---------- ambient occlusion (scalable ambient obscurance) ----------
// Reads the resolved scene depth, writes AO to R and linear depth to G at half resolution.
const AO = `
uniform sampler2D tDepth; uniform mat4 projInv; uniform vec2 res; uniform float radius, intensity, projScale, far;
varying vec2 vUv;
// every depth read snaps to a texel centre: these passes run at a fraction of the depth buffer's resolution,
// so their pixel centres sit on its texel corners where nearest sampling flips between neighbours and
// the reconstructed normals band into dark stripes along flat walls
vec3 vpos( vec2 uv ) { uv = ( floor( uv * res ) + 0.5 ) / res; float d = texture2D( tDepth, uv ).r; vec4 p = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return p.xyz / p.w; }
void main(){
  vec2 uv0 = ( floor( vUv * res ) + 0.5 ) / res;
  float d = texture2D( tDepth, uv0 ).r;
  if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0, 60000.0, 0.0, 1.0 ); return; } // sky (half-float safe marker)
  vec3 C = vpos( uv0 );
  if ( -C.z > far ) { gl_FragColor = vec4( 1.0, -C.z, 0.0, 1.0 ); return; }
  vec2 px = 1.0 / res;
  vec3 R = vpos( uv0 + vec2( px.x, 0.0 ) ), L = vpos( uv0 - vec2( px.x, 0.0 ) );
  vec3 U = vpos( uv0 + vec2( 0.0, px.y ) ), D = vpos( uv0 - vec2( 0.0, px.y ) );
  vec3 dx = abs( R.z - C.z ) < abs( C.z - L.z ) ? R - C : C - L;
  vec3 dy = abs( U.z - C.z ) < abs( C.z - D.z ) ? U - C : C - D;
  vec3 N = normalize( cross( dx, dy ) );
  float ssR = projScale * radius / -C.z;
  if ( ssR < 2.0 ) { gl_FragColor = vec4( 1.0, -C.z, 0.0, 1.0 ); return; }
  ssR = min( ssR, 160.0 );
  float ang = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  float r2 = radius * radius, bias = 0.0015 * -C.z + 0.004, sum = 0.0;
  for ( int i = 0; i < NS; i ++ ) {
    float a = ( float( i ) + 0.5 ) / float( NS );
    float th = a * 7.0 * 6.2831853 + ang;
    vec3 Q = vpos( uv0 + vec2( cos( th ), sin( th ) ) * a * ssR * px );
    vec3 v = Q - C;
    float vv = dot( v, v ), vn = dot( v, N );
    float f = max( r2 - vv, 0.0 );
    sum += f * f * f * max( ( vn - bias ) / ( 0.01 + vv ), 0.0 );
  }
  float A = max( 0.0, 1.0 - sum * intensity * 5.0 / ( r2 * r2 * r2 * float( NS ) ) );
  gl_FragColor = vec4( A, -C.z, 0.0, 1.0 );
}`;

// depth-aware separable blur that keeps the depth channel
const AO_BLUR = `
uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec4 c = texture2D( tSrc, vUv ); float z = c.g;
  if ( z > 50000.0 ) { gl_FragColor = c; return; }
  float W[4]; W[0] = 0.1945946; W[1] = 0.1216216; W[2] = 0.0540541; W[3] = 0.0162162;
  float sum = c.r * 0.2270270, ws = 0.2270270;
  for ( int i = 1; i <= 4; i ++ ) {
    for ( int s = -1; s <= 1; s += 2 ) {
      vec4 t = texture2D( tSrc, vUv + dir * float( i * s ) );
      float w = W[ i - 1 ] * max( 0.0, 1.0 - abs( t.g - z ) / ( z * 0.04 + 0.04 ) );
      sum += t.r * w; ws += w;
    }
  }
  gl_FragColor = vec4( sum / ws, z, 0.0, 1.0 );
}`;

// ---------- screen-space global illumination (one diffuse bounce) ----------
// Quarter resolution. Every lit surface within ~2 m that faces this point
// sends some of its light back: sunlit sand warms the shaded side of a wall,
// the carpet tints the bottom of the office walls, a lit floor lifts the
// ceiling. Colour from the (pre-AO) half-res scene copy, cosine-weighted and
// distance-attenuated; RGB = bounce light, A = linear depth for the blur.
const GI = `
uniform sampler2D tDepth, tColor; uniform mat4 projInv; uniform vec2 res, depthRes; uniform float radius, projScale, far;
varying vec2 vUv;
vec3 vpos( vec2 uv ) { uv = ( floor( uv * depthRes ) + 0.5 ) / depthRes; float d = texture2D( tDepth, uv ).r; vec4 p = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return p.xyz / p.w; }
void main(){
  vec2 uv0 = ( floor( vUv * depthRes ) + 0.5 ) / depthRes;
  float d = texture2D( tDepth, uv0 ).r;
  if ( d >= 0.99999 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, 60000.0 ); return; }
  vec3 C = vpos( uv0 ); float z = -C.z;
  if ( z > far ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, z ); return; }
  vec2 px = 1.0 / depthRes;
  vec3 R = vpos( uv0 + vec2( px.x, 0.0 ) ), L = vpos( uv0 - vec2( px.x, 0.0 ) );
  vec3 U = vpos( uv0 + vec2( 0.0, px.y ) ), D = vpos( uv0 - vec2( 0.0, px.y ) );
  vec3 N = normalize( cross( abs( R.z - C.z ) < abs( C.z - L.z ) ? R - C : C - L, abs( U.z - C.z ) < abs( C.z - D.z ) ? U - C : C - D ) );
  float ssR = min( projScale * radius / z, 0.35 * res.y );
  if ( ssR < 2.0 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, z ); return; }
  float ang = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  vec3 acc = vec3( 0.0 ); float r2 = radius * radius;
  for ( int i = 0; i < NS; i ++ ) {
    float a = ( float( i ) + 0.5 ) / float( NS );
    float th = float( i ) * 2.3999632 + ang;
    vec2 suv = uv0 + vec2( cos( th ), sin( th ) ) * sqrt( a ) * ssR / res;
    if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) continue;
    vec3 v = vpos( suv ) - C;
    float vv = dot( v, v );
    float cosR = max( dot( N, v ) * inversesqrt( vv + 1e-4 ), 0.0 );
    vec3 Lq = min( texture2D( tColor, suv ).rgb, vec3( 6.0 ) );   // no fireflies from glints and flashes
    acc += Lq * cosR / ( 1.0 + vv / r2 ) * step( vv, r2 * 9.0 );
  }
  gl_FragColor = vec4( acc / float( NS ), z );
}`;
const GI_BLUR = `
uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec4 c = texture2D( tSrc, vUv ); float z = c.a;
  if ( z > 50000.0 ) { gl_FragColor = c; return; }
  vec3 sum = c.rgb * 0.3; float ws = 0.3;
  for ( int i = 1; i <= 3; i ++ ) {
    for ( int s = -1; s <= 1; s += 2 ) {
      vec4 t = texture2D( tSrc, vUv + dir * float( i * s ) * 1.5 );
      float w = ( 0.4 - float( i ) * 0.1 ) * max( 0.0, 1.0 - abs( t.a - z ) / ( z * 0.05 + 0.05 ) );
      sum += t.rgb * w; ws += w;
    }
  }
  gl_FragColor = vec4( sum / ws, z );
}`;

// Applies AO and the atmosphere to the world before transparent effects and
// the weapon are drawn. Blending is src + dst * srcAlpha, so the output is
// (fog colour * fog, ao * (1 - fog)).
const APPLY = `
uniform sampler2D tAO, tDepth, tColor, heightMap, macroMap, tGI; uniform vec2 aoRes, res, giRes; uniform float giStrength; uniform mat4 projInv, camWorld, proj;
uniform vec3 camPos, fogColor, sunDir, sunColor, sunView; uniform float fogDensity, fogFalloff, aoStrength, aoFar, wet, contact, time;
varying vec2 vUv;
vec3 vpos( vec2 uv, float d ) { vec4 p = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return p.xyz / p.w; }
float viewDist( vec2 uv ) { float nd = texture2D( tDepth, uv ).r * 2.0 - 1.0; return proj[3][2] / ( nd + proj[2][2] ); }
vec2 toScreen( vec3 p ) { vec4 c = proj * vec4( p, 1.0 ); return c.xy / c.w * 0.5 + 0.5; }
void main(){
  float d = texture2D( tDepth, vUv ).r;
  if ( d >= 0.99999 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 ); return; }
  vec3 vp = vpos( vUv, d ); float z = -vp.z;
  // surface normal from the depth buffer (smallest-difference neighbours)
  vec2 px = 1.0 / res;
  vec3 R0 = vpos( vUv + vec2( px.x, 0.0 ), texture2D( tDepth, vUv + vec2( px.x, 0.0 ) ).r ), L0 = vpos( vUv - vec2( px.x, 0.0 ), texture2D( tDepth, vUv - vec2( px.x, 0.0 ) ).r );
  vec3 U0 = vpos( vUv + vec2( 0.0, px.y ), texture2D( tDepth, vUv + vec2( 0.0, px.y ) ).r ), D0 = vpos( vUv - vec2( 0.0, px.y ), texture2D( tDepth, vUv - vec2( 0.0, px.y ) ).r );
  vec3 N = normalize( cross( abs( R0.z - vp.z ) < abs( vp.z - L0.z ) ? R0 - vp : vp - L0, abs( U0.z - vp.z ) < abs( vp.z - D0.z ) ? U0 - vp : vp - D0 ) );
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  // ray-marched contact shadows towards the sun: small occluders the shadow map is too coarse for
  float cs = 1.0;
  if ( contact > 0.0 && z < 35.0 && dot( N, sunView ) > 0.05 ) {
    float stepL = 0.03 * ( 1.0 + z * 0.03 );
    for ( int i = 1; i <= 12; i ++ ) {
      vec3 q = vp + sunView * stepL * ( float( i ) + jitter );
      vec2 suv = toScreen( q );
      if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) break;
      float dz = -q.z - viewDist( suv );
      if ( dz > 0.015 + z * 0.001 && dz < 0.4 ) { cs = 1.0 - 0.5 * contact * ( 1.0 - smoothstep( 20.0, 35.0, z ) ); break; }
    }
  }
  vec2 t = vUv * aoRes - 0.5, f = fract( t ), b = ( floor( t ) + 0.5 ) / aoRes, s = 1.0 / aoRes;
  vec4 a00 = texture2D( tAO, b ), a10 = texture2D( tAO, b + vec2( s.x, 0.0 ) ), a01 = texture2D( tAO, b + vec2( 0.0, s.y ) ), a11 = texture2D( tAO, b + s );
  vec4 w = vec4( ( 1.0 - f.x ) * ( 1.0 - f.y ), f.x * ( 1.0 - f.y ), ( 1.0 - f.x ) * f.y, f.x * f.y ) + 1e-3;
  w *= exp( -abs( vec4( a00.g, a10.g, a01.g, a11.g ) - z ) / ( z * 0.03 + 0.03 ) );
  float ws = dot( w, vec4( 1.0 ) );
  float ao = ws > 1e-4 ? dot( vec4( a00.r, a10.r, a01.r, a11.r ), w ) / ws : 1.0;
  ao = mix( 1.0, ao, aoStrength * ( 1.0 - smoothstep( aoFar * 0.6, aoFar, z ) ) );
  vec3 wd = ( camWorld * vec4( vp, 0.0 ) ).xyz; float dist = length( wd ); wd /= dist;
  float k = fogFalloff;
  float fh = fogDensity * exp( -k * max( camPos.y, 0.0 ) ) * ( abs( wd.y ) > 1e-4 ? ( 1.0 - exp( -k * wd.y * dist ) ) / ( k * wd.y ) : dist );
  float fog = 1.0 - exp( -max( fh, 0.0 ) );
  float mu = max( dot( wd, sunDir ), 0.0 );
  vec3 fc = fogColor + sunColor * ( pow( mu, 6.0 ) * 0.3 + pow( mu, 48.0 ) * 0.8 );
  // screen-space ray-traced reflections on wet surfaces (puddles mirror the scene)
  vec3 refl = vec3( 0.0 ); float rw = 0.0;
  if ( wet > 0.0 ) {
    vec3 wp = camPos + wd * dist;
    vec3 Nw = ( camWorld * vec4( N, 0.0 ) ).xyz;
    float up = smoothstep( 0.8, 0.95, Nw.y );
    float puddle = 0.0;
    if ( wp.y < 0.12 ) {
      vec2 guv = wp.xz / vec2( 2.48, -2.48 );
      float low = 1.0 - texture2D( heightMap, guv ).r;
      puddle = smoothstep( 0.56, 0.64, low * 0.5 + texture2D( macroMap, guv * 0.037 + 0.5 ).r * 0.7 );
    }
    float mask = wet * ( up * mix( 0.12, 1.0, puddle ) + ( 1.0 - up ) * 0.06 );
    vec3 V = normalize( vp );
    vec3 Rv = normalize( reflect( V, N ) );
    float F = 0.02 + 0.98 * pow( 1.0 - max( dot( N, -V ), 0.0 ), 5.0 );
    rw = mask * F;
    if ( rw > 0.004 ) {
      vec3 hit = fogColor * 1.05; float found = 0.0;
      float t = 0.15 + jitter * 0.25;
      for ( int i = 0; i < 28; i ++ ) {
        vec3 q = vp + Rv * t;
        vec2 suv = toScreen( q );
        if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 || q.z > -0.05 ) break;
        float sd = texture2D( tDepth, suv ).r;
        float dz = -q.z - viewDist( suv );
        if ( sd >= 0.99999 && Rv.y > 0.0 && i > 2 ) { hit = texture2D( tColor, suv ).rgb; found = 1.0; break; } // sky
        if ( dz > 0.0 && dz < 0.4 + t * 0.08 ) {
          // refine the intersection
          float a = t - ( 0.12 + t * 0.12 ), b = t;
          for ( int k = 0; k < 5; k ++ ) { float m = ( a + b ) * 0.5; vec3 qm = vp + Rv * m; if ( -qm.z - viewDist( toScreen( qm ) ) > 0.0 ) b = m; else a = m; }
          suv = toScreen( vp + Rv * b );
          vec2 e = smoothstep( 0.0, 0.08, suv ) * smoothstep( 1.0, 0.92, suv );
          hit = mix( fogColor * 1.05, texture2D( tColor, suv ).rgb, e.x * e.y ); found = 1.0; break;
        }
        t += 0.12 + t * 0.12;
      }
      refl = hit;
    }
  }
  // one bounce of indirect light, tinted by the surface (its chroma at a mid-grey reflectance)
  vec3 bounce = vec3( 0.0 );
  if ( giStrength > 0.0 ) {
    vec2 gt = vUv * giRes - 0.5, gf = fract( gt ), gb = ( floor( gt ) + 0.5 ) / giRes, gs = 1.0 / giRes;
    vec4 g00 = texture2D( tGI, gb ), g10 = texture2D( tGI, gb + vec2( gs.x, 0.0 ) ), g01 = texture2D( tGI, gb + vec2( 0.0, gs.y ) ), g11 = texture2D( tGI, gb + gs );
    vec4 gw = vec4( ( 1.0 - gf.x ) * ( 1.0 - gf.y ), gf.x * ( 1.0 - gf.y ), ( 1.0 - gf.x ) * gf.y, gf.x * gf.y ) + 1e-3;
    gw *= exp( -abs( vec4( g00.a, g10.a, g01.a, g11.a ) - z ) / ( z * 0.04 + 0.04 ) );
    float gws = dot( gw, vec4( 1.0 ) );
    vec3 gi = gws > 1e-4 ? ( g00.rgb * gw.x + g10.rgb * gw.y + g01.rgb * gw.z + g11.rgb * gw.w ) / gws : vec3( 0.0 );
    vec3 base = texture2D( tColor, vUv ).rgb;
    float bl = dot( base, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 albedo = mix( vec3( 0.42 ), clamp( base / max( bl, 0.03 ), 0.0, 2.5 ) * 0.42, 0.6 );
    bounce = gi * albedo * giStrength * ( 0.4 + 0.6 * ao );
  }
  gl_FragColor = vec4( fc * fog + ( refl * rw + bounce * ( 1.0 - rw ) ) * ( 1.0 - fog ), ao * cs * ( 1.0 - fog ) * ( 1.0 - rw ) );
}`;

const COPY = `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4( texture2D( tSrc, vUv ).rgb, 1.0 ); }`;

const COMPOSITE = `
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloomStrength, exposure, mode, time, grain, vignette, saturation, fringe, lowHealth;
uniform float nvgGain, noiseAmt, signal, thermalPalette, useBloom, contrast, sharpen;
uniform vec3 nvgTint, lift, gain;
uniform vec2 res, sunUV;
uniform float sunVis;
uniform sampler2D tWorld, tDepth; uniform float useWorld, haze, rays, tonemap;
uniform mat4 projInv, camWorld; uniform vec3 sunCol;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inM * (color / 0.6); color = RRTAndODTFit(color); color = outM * color; return clamp(color, 0.0, 1.0);
}
// AgX (Troy Sobotka) with the polynomial fit by Benjamin Wrensch: a filmic curve that
// rolls bright colours off towards white like a real camera sensor.
vec3 agxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 v){
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  v = inM * max(v, 1e-10);
  v = clamp(log2(v), -12.47393, 4.026069);
  v = agxContrast((v + 12.47393) / 16.500499);
  // "punchy" look: a touch more contrast and saturation
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, 0.0), vec3(1.18));
  v = l + 1.22 * (v - l);
  v = outM * v;
  return clamp(pow(max(v, 0.0), vec3(2.2)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 ironbow(float t){
  return clamp(vec3(1.5 * t + 0.05, 1.8 * t * t - 0.1, 0.55 * sin(3.14159 * t) + 0.9 * max(0.0, t - 0.8) * 3.0), 0.0, 1.0);
}

void main(){
  vec2 uv = vUv;
  float m = mode;
  bool fpv = m > 2.5 && m < 3.5, digi = m > 3.5;
  if (digi) {
    // digital scope: the image is resampled on the sensor's pixel grid
    vec2 sensor = vec2(720.0, 720.0 * res.y / res.x);
    uv = (floor(uv * sensor) + 0.5) / sensor;
  }
  if (fpv) {
    // FPV analog video: barrel distortion + line jitter when the signal is weak
    vec2 c = uv - 0.5;
    c *= 1.0 + 0.22 * dot(c, c);
    uv = c * 0.94 + 0.5;
    float bad = 1.0 - signal;
    float line = floor(uv.y * 220.0);
    uv.x += (hash(vec2(line, floor(time * 30.0))) - 0.5) * 0.03 * bad * bad;
    if (hash(vec2(floor(time * 12.0), 3.0)) < bad * 0.35) uv.y += (hash(vec2(time, 1.0)) - 0.5) * 0.05 * bad;
  }
  // heat shimmer over hot ground in the distance (never on the weapon)
  if (useWorld > 0.5 && haze > 0.0 && m < 0.5) {
    float wz = texture2D(tWorld, uv).g;
    vec4 pp = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 wdir = normalize((camWorld * vec4(pp.xyz / pp.w, 0.0)).xyz);
    float vm = step(texture2D(tDepth, uv).r, 0.99999);
    float amt = haze * smoothstep(25.0, 220.0, min(wz, 3000.0)) * exp(-abs(wdir.y) * 16.0) * (1.0 - vm);
    vec2 q = uv * vec2(res.x / res.y, 1.0);
    uv += vec2(sin(q.y * 310.0 + time * 7.3 + sin(q.x * 41.0 + time * 1.9) * 2.0), cos(q.y * 230.0 - time * 5.1 + q.x * 29.0)) * amt * 0.0011;
  }
  vec3 col;
  vec2 dc = (uv - 0.5) * fringe;
  if (m < 0.5 || fpv) col = vec3(texture2D(tScene, uv + dc).r, texture2D(tScene, uv).g, texture2D(tScene, uv - dc).b);
  else col = texture2D(tScene, uv).rgb;
  if (m < 0.5 && sharpen > 0.0) {
    // contrast-adaptive sharpening: restores texture detail lost to upscaling and MSAA resolve,
    // clamped to the local range so edges never ring
    vec2 tx = 1.0 / res;
    vec3 sa = texture2D(tScene, uv + vec2(tx.x, 0.0)).rgb, sb = texture2D(tScene, uv - vec2(tx.x, 0.0)).rgb;
    vec3 sc = texture2D(tScene, uv + vec2(0.0, tx.y)).rgb, sd = texture2D(tScene, uv - vec2(0.0, tx.y)).rgb;
    vec3 mn = min(min(sa, sb), min(sc, sd)), mx = max(max(sa, sb), max(sc, sd));
    float amp = clamp(min(dot(mn, vec3(0.333)), 2.0 - dot(mx, vec3(0.333))) / max(dot(mx, vec3(0.333)), 1e-3), 0.0, 1.0);
    vec3 sh = col + (col - (sa + sb + sc + sd) * 0.25) * sharpen * (0.4 + 0.6 * sqrt(amp));
    col = clamp(sh, min(mn, col), max(mx, col));
  }
  vec3 bloom = useBloom > 0.5 ? texture2D(tBloom, uv).rgb : vec3(0.0);
  float n = hash(uv * res + fract(time * 7.13) * 100.0) - 0.5;

  if (digi) {
    // day: colour display with limited dynamic range; night: high-gain monochrome sensor
    vec3 c = col + bloom * 0.6;
    if (nvgGain > 2.0) {
      float l = dot(c, vec3(0.3, 0.59, 0.11)) * nvgGain * 1.7;
      l = 1.0 - exp(-l * 1.3);
      l = clamp(l + n * 0.16 * (1.1 - l), 0.0, 1.0);
      col = vec3(l) * vec3(0.84, 1.0, 0.88);
    } else {
      col = aces(c * exposure * 1.05);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 0.78);
      col = toSRGB(clamp((col - 0.5) * 1.12 + 0.5, 0.0, 1.0)) + n * 0.03;
    }
    vec2 cell = fract(vUv * vec2(720.0, 720.0 * res.y / res.x));
    col *= 0.9 + 0.1 * step(0.12, cell.x) * step(0.12, cell.y);
  } else if (m < 0.5 || fpv) {
    col += bloom * bloomStrength;
    // crepuscular rays: march towards the sun through the sky mask
    if (useWorld > 0.5 && rays > 0.001) {
      vec2 delta = (sunUV - uv) / 30.0;
      vec2 p = uv + delta * hash(uv * res + fract(time));
      float acc = 0.0, w = 1.0, ws = 0.0;
      for (int i = 0; i < 30; i++) {
        p += delta;
        vec2 cp = clamp(p, vec2(0.001), vec2(0.999));
        acc += step(50000.0, texture2D(tWorld, cp).g) * w; ws += w; w *= 0.97;
      }
      float fall = exp(-length((uv - sunUV) * vec2(res.x / res.y, 1.0)) * 1.4);
      col += sunCol * (acc / ws) * rays * fall;
    }
    if (sunVis > 0.001) {
      // sun glare, anamorphic streak and lens ghosts
      vec2 asp = vec2(res.x / res.y, 1.0);
      vec2 d = (uv - sunUV) * asp;
      float r = length(d);
      col += vec3(1.0, 0.94, 0.82) * (exp(-r * 10.0) * 2.2 + exp(-r * 2.6) * 0.3) * sunVis;
      col += vec3(1.0, 0.88, 0.72) * exp(-abs(d.y) * 110.0) * exp(-abs(d.x) * 2.4) * 0.45 * sunVis;
      vec2 axis = vec2(0.5) - sunUV;
      for (int i = 1; i <= 4; i++) {
        float fi = float(i);
        vec2 gp = sunUV + axis * (0.55 + fi * 0.42);
        float gr = length((uv - gp) * asp);
        float rad = 0.025 + 0.018 * fi;
        vec3 tint = i == 2 ? vec3(0.9, 0.6, 0.35) : vec3(0.45, 0.65, 1.0);
        col += tint * smoothstep(rad, rad * 0.6, gr) * 0.06 * sunVis;
      }
    }
    col = tonemap > 0.5 ? agx(col * exposure) : aces(col * exposure);
    // grade: lift shadows / tint highlights, saturation, contrast
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, saturation - lowHealth * 0.55);
    col = col * gain + lift * (1.0 - col);
    col = clamp((col - 0.5) * contrast + 0.5, 0.0, 1.0);
    col = toSRGB(col);
    // sensor grain: strongest in the shadows, almost gone in the highlights
    col += n * grain * (1.35 - 0.9 * dot(col, vec3(0.333)));
  } else if (m < 1.5) {
    // Night vision: image intensifier with auto-brightness, phosphor tint and scintillation
    float l = dot(col + bloom * 2.2, vec3(0.3, 0.59, 0.11)) * nvgGain;
    l = 1.0 - exp(-l * 1.6);
    l += n * noiseAmt * (1.2 - l);
    l = clamp(l * 1.06 + 0.02, 0.0, 1.0);
    col = nvgTint * pow(l, 0.85);
    // honeycomb / tube texture
    col *= 0.93 + 0.07 * hash(floor(uv * res / 2.0));
    vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    float d = min(length(p - vec2(-0.29, 0.0)), length(p + vec2(-0.29, 0.0)));
    col *= smoothstep(0.53, 0.47, d);
    col *= mix(1.0, smoothstep(0.55, 0.2, d), 0.35);
  } else {
    // Thermal: red channel carries heat. Low-res sensor, blur, auto contrast, palette.
    vec2 sensor = vec2(480.0, 480.0 * res.y / res.x);
    vec2 suv = (floor(uv * sensor) + 0.5) / sensor;
    vec2 t = 1.0 / sensor;
    float h = texture2D(tScene, suv).r * 0.5 + (texture2D(tScene, suv + vec2(t.x, 0.0)).r + texture2D(tScene, suv - vec2(t.x, 0.0)).r
            + texture2D(tScene, suv + vec2(0.0, t.y)).r + texture2D(tScene, suv - vec2(0.0, t.y)).r) * 0.125;
    h = clamp((h - 0.08) / 0.92, 0.0, 1.0);
    h = pow(h, 0.9) + n * 0.035;
    h = clamp(h, 0.0, 1.0);
    if (thermalPalette < 0.5) col = vec3(h);
    else if (thermalPalette < 1.5) col = vec3(1.0 - h);
    else col = ironbow(h);
    col *= 0.96 + 0.04 * sin(uv.y * res.y * 1.2);
  }

  // lens vignette
  vec2 vq = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
  col *= mix(1.0, smoothstep(1.05, 0.25, length(vq)), vignette);

  if (fpv) {
    float bad = 1.0 - signal;
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(lum), 0.25);
    col *= 0.9 + 0.1 * sin(vUv.y * res.y * 1.6 + time * 40.0);
    float st = hash(vec2(floor(vUv.x * res.x / 2.0), floor(vUv.y * res.y / 2.0)) + fract(time * 13.7));
    col = mix(col, vec3(st), clamp(bad * bad * 1.3, 0.0, 1.0));
    col += (st - 0.5) * 0.08;
    vec2 cc = vUv - 0.5; col *= smoothstep(0.75, 0.45, length(cc * vec2(1.0, 1.25)));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.samples = 4;
    this.rt = this._sceneTarget(4, 4);
    const aoOpts = { type: this.type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoA = new THREE.WebGLRenderTarget(4, 4, aoOpts);
    this.aoB = new THREE.WebGLRenderTarget(4, 4, aoOpts);
    this.colA = new THREE.WebGLRenderTarget(4, 4, aoOpts); // scene colour for reflections and bounce light
    this.giA = new THREE.WebGLRenderTarget(4, 4, aoOpts);  // quarter-res bounce light
    this.giB = new THREE.WebGLRenderTarget(4, 4, aoOpts);
    this.gi = false;
    this.ao = false;
    this.levels = [];
    for (let i = 0; i < 5; i++) this.levels.push(new THREE.WebGLRenderTarget(4, 4, { type: this.type, depthBuffer: false }));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, null);
    this.quad.frustumCulled = false;
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.bright = mk(BRIGHT, { tSrc: { value: null }, threshold: { value: 1.2 }, texel: { value: new THREE.Vector2() } });
    this.down = mk(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = mk(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.comp = mk(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, bloomStrength: { value: 0.08 }, exposure: { value: 1 },
      mode: { value: 0 }, time: { value: 0 }, grain: { value: 0.018 }, vignette: { value: 0.35 }, saturation: { value: 1.06 },
      fringe: { value: 0.0025 }, lowHealth: { value: 0 }, nvgGain: { value: 8 }, noiseAmt: { value: 0.25 }, signal: { value: 1 },
      thermalPalette: { value: 0 }, useBloom: { value: 1 }, contrast: { value: 1.04 }, sharpen: { value: 0.35 },
      nvgTint: { value: new THREE.Color(0.52, 1.0, 0.62) }, lift: { value: new THREE.Color(0.012, 0.014, 0.02) }, gain: { value: new THREE.Color(1.02, 1.0, 0.97) },
      res: { value: new THREE.Vector2(1, 1) }, sunUV: { value: new THREE.Vector2(0.5, 0.5) }, sunVis: { value: 0 },
    });
    this.aoMat = mk(AO, { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, res: { value: new THREE.Vector2() },
      radius: { value: 0.75 }, intensity: { value: 1.1 }, projScale: { value: 1 }, far: { value: 90 } }, { defines: { NS: 16 } });
    this.copyMat = mk(COPY, { tSrc: { value: null } });
    this.blurMat = mk(AO_BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.giMat = mk(GI, { tDepth: { value: null }, tColor: { value: null }, projInv: { value: new THREE.Matrix4() }, res: { value: new THREE.Vector2() },
      depthRes: { value: new THREE.Vector2() }, radius: { value: 2.2 }, projScale: { value: 1 }, far: { value: 70 } }, { defines: { NS: 12 } });
    this.giBlurMat = mk(GI_BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.applyMat = mk(APPLY, {
      tAO: { value: null }, tDepth: { value: null }, aoRes: { value: new THREE.Vector2() }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
      camPos: { value: new THREE.Vector3() }, fogColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
      fogDensity: { value: 0.0005 }, fogFalloff: { value: 0.02 }, aoStrength: { value: 1 }, aoFar: { value: 90 },
      tColor: { value: null }, heightMap: { value: null }, macroMap: { value: null }, res: { value: new THREE.Vector2() }, proj: { value: new THREE.Matrix4() },
      sunView: { value: new THREE.Vector3() }, wet: { value: 0 }, contact: { value: 0 }, time: { value: 0 },
      tGI: { value: null }, giRes: { value: new THREE.Vector2(1, 1) }, giStrength: { value: 0 },
    }, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true });
    Object.assign(this.comp.uniforms, {
      tWorld: { value: null }, tDepth: { value: null }, useWorld: { value: 0 }, haze: { value: 0 }, rays: { value: 0 }, tonemap: { value: 1 },
      projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, sunCol: { value: new THREE.Color(1.0, 0.85, 0.62) },
    });
    this.bloom = true;
  }

  _sceneTarget(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: this.type, samples: this.samples });
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
    return rt;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rt.setSize(w, h);
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.aoA.setSize(hw, hh); this.aoB.setSize(hw, hh); this.colA.setSize(hw, hh);
    const gd = this.giDiv || 4, qw = Math.max(1, Math.ceil(w / gd)), qh = Math.max(1, Math.ceil(h / gd));
    this.giA.setSize(qw, qh); this.giB.setSize(qw, qh);
    let lw = w, lh = h;
    for (const l of this.levels) { lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2)); l.setSize(lw, lh); }
    this.comp.uniforms.res.value.set(w, h);
  }

  setQuality(q) {
    this.bloom = q !== 'low';
    this.ao = q === 'cinematic' || q === 'ultra' || q === 'high' || q === 'auto';
    this.gi = this.ao;
    this.sharpen = q === 'low' ? 0.25 : q === 'medium' ? 0.35 : q === 'cinematic' ? 0.2 : 0.3;
    // Cinematic: twice the occlusion and bounce samples, bounce light at half instead of quarter resolution
    const cine = q === 'cinematic';
    if (cine !== !!this.cine) {
      this.cine = cine;
      this.aoMat.defines.NS = cine ? 32 : 16; this.aoMat.needsUpdate = true;
      this.giMat.defines.NS = cine ? 24 : 12; this.giMat.needsUpdate = true;
      this.giDiv = cine ? 2 : 4;
      if (this.w) this.setSize(this.w, this.h);
    }
    const s = q === 'low' ? 0 : cine ? Math.min(8, this.r.capabilities.maxSamples || 4) : 4;
    if (s !== this.samples) {
      this.samples = s;
      this.rt.depthTexture.dispose();
      this.rt.dispose();
      this.rt = this._sceneTarget(this.w || 4, this.h || 4);
    }
  }

  /**
   * After the opaque world is drawn into rt: screen-space AO + atmospheric
   * perspective, blended back into rt. Leaves rt bound as the render target.
   */
  world(cam, u) {
    const r = this.r;
    const auto = r.autoClear;
    r.autoClear = false;
    const A = this.aoMat.uniforms;
    A.tDepth.value = this.rt.depthTexture;
    A.projInv.value.copy(cam.projectionMatrixInverse);
    A.res.value.set(this.w, this.h);
    A.projScale.value = cam.projectionMatrix.elements[5] * 0.5 * this.h;
    this._pass(this.aoMat, this.aoA);
    const B = this.blurMat.uniforms;
    B.tSrc.value = this.aoA.texture; B.dir.value.set(1 / this.aoA.width, 0);
    this._pass(this.blurMat, this.aoB);
    B.tSrc.value = this.aoB.texture; B.dir.value.set(0, 1 / this.aoA.height);
    this._pass(this.blurMat, this.aoA);
    const P = this.applyMat.uniforms;
    const gi = this.gi && (u.gi ?? 1.6) > 0;
    if (u.wet > 0 || gi) { this.copyMat.uniforms.tSrc.value = this.rt.texture; this._pass(this.copyMat, this.colA); }
    if (gi) {
      const G = this.giMat.uniforms;
      G.tDepth.value = this.rt.depthTexture; G.tColor.value = this.colA.texture;
      G.projInv.value.copy(cam.projectionMatrixInverse);
      G.res.value.set(this.giA.width, this.giA.height); G.depthRes.value.set(this.w, this.h);
      G.projScale.value = cam.projectionMatrix.elements[5] * 0.5 * this.giA.height;
      this._pass(this.giMat, this.giA);
      const GB = this.giBlurMat.uniforms;
      GB.tSrc.value = this.giA.texture; GB.dir.value.set(1 / this.giA.width, 0); this._pass(this.giBlurMat, this.giB);
      GB.tSrc.value = this.giB.texture; GB.dir.value.set(0, 1 / this.giA.height); this._pass(this.giBlurMat, this.giA);
      P.tGI.value = this.giA.texture; P.giRes.value.set(this.giA.width, this.giA.height);
    }
    P.giStrength.value = gi ? (u.gi ?? 1.6) : 0;
    P.tColor.value = this.colA.texture; P.heightMap.value = u.heightMap || null; P.macroMap.value = u.macroMap || null;
    P.res.value.set(this.w, this.h); P.proj.value.copy(cam.projectionMatrix);
    P.sunView.value.copy(u.sunDir).transformDirection(cam.matrixWorldInverse);
    P.wet.value = u.wet || 0; P.contact.value = u.contact || 0;
    P.tAO.value = this.aoA.texture; P.tDepth.value = this.rt.depthTexture;
    P.aoRes.value.set(this.aoA.width, this.aoA.height);
    P.projInv.value.copy(cam.projectionMatrixInverse);
    P.camWorld.value.copy(cam.matrixWorld);
    P.camPos.value.setFromMatrixPosition(cam.matrixWorld);
    P.fogColor.value.copy(u.fogColor);
    P.sunDir.value.copy(u.sunDir);
    P.sunColor.value.copy(u.sunColor);
    P.fogDensity.value = u.fogDensity;
    P.fogFalloff.value = u.fogFalloff;
    P.aoStrength.value = u.aoStrength ?? 1;
    this._pass(this.applyMat, this.rt, false);
    r.autoClear = auto;
    this._worldCam = cam;
  }

  _pass(mat, target, clear = true) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    if (clear) this.r.clear(true, false, false);
    this.r.render(this.quad, this.cam);
  }

  /** Runs bloom + composite and writes the final image to the screen. */
  finish(u) {
    const r = this.r;
    const auto = r.autoClear;
    r.autoClear = false;
    const C = this.comp.uniforms;
    const useBloom = this.bloom && u.mode !== MODE.thermal;
    if (useBloom) {
      const L = this.levels;
      this.bright.uniforms.tSrc.value = this.rt.texture;
      this.bright.uniforms.threshold.value = u.threshold ?? 1.2;
      this.bright.uniforms.texel.value.set(1 / this.w, 1 / this.h);
      this._pass(this.bright, L[0]);
      for (let i = 1; i < L.length; i++) {
        this.down.uniforms.tSrc.value = L[i - 1].texture;
        this.down.uniforms.texel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
        this._pass(this.down, L[i]);
      }
      for (let i = L.length - 1; i > 0; i--) {
        this.up.uniforms.tSrc.value = L[i].texture;
        this.up.uniforms.texel.value.set(0.5 / L[i].width, 0.5 / L[i].height);
        this._pass(this.up, L[i - 1], false);
      }
      C.tBloom.value = L[0].texture;
    }
    C.useBloom.value = useBloom ? 1 : 0;
    C.tScene.value = this.rt.texture;
    const world = this.ao && u.world && this._worldCam;
    C.useWorld.value = world ? 1 : 0;
    if (world) {
      C.tWorld.value = this.aoA.texture;
      C.tDepth.value = this.rt.depthTexture;
      C.projInv.value.copy(this._worldCam.projectionMatrixInverse);
      C.camWorld.value.copy(this._worldCam.matrixWorld);
    }
    C.haze.value = u.haze ?? 0;
    C.rays.value = u.rays ?? 0;
    C.tonemap.value = u.tonemap ?? 1;
    this._worldCam = null;
    C.mode.value = u.mode;
    C.time.value = u.time;
    C.exposure.value = u.exposure ?? 1;
    C.bloomStrength.value = u.bloomStrength ?? 0.08;
    C.lowHealth.value = u.lowHealth ?? 0;
    C.nvgGain.value = u.nvgGain ?? 8;
    C.noiseAmt.value = u.noise ?? 0.25;
    C.signal.value = u.signal ?? 1;
    C.thermalPalette.value = u.palette ?? 0;
    C.vignette.value = u.vignette ?? 0.35;
    C.grain.value = u.grain ?? 0.018;
    C.sharpen.value = u.sharpen ?? this.sharpen ?? 0.3;
    if (u.tint) C.nvgTint.value.copy(u.tint);
    C.sunVis.value = u.sunVis ?? 0;
    if (u.sunUV) C.sunUV.value.copy(u.sunUV);
    this._pass(this.comp, null);
    r.autoClear = auto;
  }
}

// ---------- thermal rendering ----------
// Every mesh is drawn with one material that writes its temperature. The
// temperature comes from object.userData.heat (set when objects are built).
export const thermalMaterial = new THREE.ShaderMaterial({
  uniforms: { heat: { value: 0.3 } },
  vertexShader: `
    #include <common>
    varying vec3 vN; varying vec3 vView;
    void main(){
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <project_vertex>
      vN = normalize(transformedNormal);
      vView = normalize(-mvPosition.xyz);
    }`,
  fragmentShader: `
    uniform float heat; varying vec3 vN; varying vec3 vView;
    void main(){
      float ndv = abs(dot(normalize(vN), normalize(vView)));
      // bodies radiate most straight on; edges read a little cooler
      float h = heat * (0.72 + 0.28 * ndv);
      gl_FragColor = vec4(h, h, h, 1.0);
    }`,
  side: THREE.DoubleSide,
});

export function withThermal(fn, ambient) {
  const proto = THREE.Mesh.prototype;
  const orig = proto.onBeforeRender;
  proto.onBeforeRender = function () {
    const h = this.userData.heat;
    thermalMaterial.uniforms.heat.value = h === undefined ? ambient : h * (this.userData.env ? ambient / 0.3 : 1);
    thermalMaterial.uniformsNeedUpdate = true;
  };
  try { fn(); } finally { proto.onBeforeRender = orig; }
}
