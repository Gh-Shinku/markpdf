export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["dist/**/*", "node_modules/**/*", "coverage/**/*"],
  rules: {
    "alpha-value-notation": null,
    "color-hex-length": null,
    "color-function-notation": "modern",
    "custom-property-empty-line-before": null,
    "declaration-empty-line-before": null,
    "media-feature-range-notation": null,
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    "property-no-deprecated": null,
    "rule-empty-line-before": null,
    "selector-class-pattern": null,
    "value-keyword-case": null,
  },
};
