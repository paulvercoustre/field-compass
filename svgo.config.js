// Optimisation settings for the partner logos in site/logos/.
//
//   npx svgo --folder site/logos --config svgo.config.js
//
// Lives at the repo root rather than inside site/ so it is not published with
// the site.
// package.json sets "type": "module", so this file must be ESM.
export default {
  multipass: true,
  // These logos are drawn in viewBox units in the hundreds, so two decimals is
  // well below a rendered pixel. Most of the payload is coordinate precision.
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // MUST stay off. preset-default drops viewBox when width/height are
          // present, and the carousel sizes every logo by height with
          // width:auto — without a viewBox the artwork cannot scale to that
          // height and the marks break.
          removeViewBox: false,
        },
      },
    },
  ],
};
