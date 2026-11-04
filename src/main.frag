#version 120

// (way more precision than a float can actually store...)
#define LOG_2 0.6931471805599453094172321214581765680755001

// start using these antialiasing values once you start (c)
#define AA 2
const int TOTAL_SAMPLES = AA * AA;

// The temporal alpha reaches 1 at this iteration count.
#define TRUE_MAX_ITERS 16384

uniform vec2 c;
uniform int MAX_ITERS;
uniform vec2 windowSizePixels;
uniform vec2 camCenterWorld;
uniform float camWorldUnitsPerPixel;

// Camera state and image from the previous frame, for reprojection.
uniform vec2 oldCamCenterWorld;
uniform float oldCamWorldUnitsPerPixel;  // 0 means there is no previous frame
uniform sampler2D oldFrame;
uniform bool cChanged;  // the old image is useless if c changed

// Use this to get a color from your smoothed Julia set escape times.
vec4 colorTime(float t) {
    return vec4(0.5 + 0.5 * cos(  0.1 * (t) + vec3(0.f, 0.35, 0.7)), 1.f);
}

struct EscapeTime {
    float iters;
    bool isInf;
};

// Escape time of iterating z^2 + c
EscapeTime escapeTimeSmooth(vec2 z) {
    // Any escape radius >= 2 is correct; 4 keeps the double log well behaved.
    const float ESCAPE_RADIUS_SQUARED = 16.0;
    for (int n = 1; n <= MAX_ITERS; ++n) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        float modulusSquared = dot(z, z);
        if (modulusSquared > ESCAPE_RADIUS_SQUARED) {
            return EscapeTime(float(n) + 1.0 - log(log(length(z))) / LOG_2, false);
        }
    }
    return EscapeTime(0.0, true);
}

vec2 windowToWorld(vec2 windowCoords) {
    return camCenterWorld + (windowCoords - windowSizePixels * 0.5) * camWorldUnitsPerPixel;
}

// For reprojection
vec2 worldToOldWindow(vec2 worldCoords) {
    return (worldCoords - oldCamCenterWorld) / oldCamWorldUnitsPerPixel +
           windowSizePixels * 0.5;
}

// For SSAA
// Given (dx, dy) in [0, AA)^2, suppose the unit square [0, 1)^2 was cut up into AA equal
// partitions along each dimension. delta((dx, dy)) returns the center of the sub-square
// which is in the dy'th row and dx'th column (both 0-indexed).
vec2 delta(vec2 dxy) {
    return (dxy + 0.5) / float(AA);
}

// Colour for one sub-sample, blended with the previous frame where it is available.
vec4 sampleColor(vec2 windowCoords) {
    vec2 world = windowToWorld(windowCoords);
    EscapeTime escape = escapeTimeSmooth(world);
    vec4 newColor = escape.isInf ? vec4(0.0, 0.0, 0.0, 1.0) : colorTime(escape.iters);

    // Nothing to reproject from on the first frame.
    if (oldCamWorldUnitsPerPixel <= 0.0) {
        return newColor;
    }

    // Outside the previous camera, there is no old value.
    vec2 oldWindow = worldToOldWindow(world);
    if (any(lessThan(oldWindow, vec2(0.0))) ||
        any(greaterThan(oldWindow, windowSizePixels))) {
        return newColor;
    }

    // Cheap escape times are already accurate, so keep the accumulated value there; expensive
    // ones benefit more from the fresh calculation. Changing c invalidates the history.
    float alpha = escape.isInf ? float(MAX_ITERS) : escape.iters;
    alpha = clamp(alpha / float(TRUE_MAX_ITERS), 0.0, 1.0);
    if (cChanged) {
        alpha = 1.0;
    }

    vec4 oldColor = texture2D(oldFrame, oldWindow / windowSizePixels);
    return mix(oldColor, newColor, alpha);
}

void main() {
    // Supersample: one sample at the centre of each sub-square of the pixel.
    vec4 color = vec4(0.0);
    for (int dy = 0; dy < AA; ++dy) {
        for (int dx = 0; dx < AA; ++dx) {
            color += sampleColor(gl_FragCoord.xy - 0.5 + delta(vec2(dx, dy)));
        }
    }
    gl_FragColor = color / float(TOTAL_SAMPLES);
}
