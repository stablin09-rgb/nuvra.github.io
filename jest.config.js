module.exports = {
  testMatch: [
    "<rootDir>/tests/**/*.test.js",
    "<rootDir>/src/**/*.test.js"
  ],
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest"
  },
  transformIgnorePatterns: [],
  moduleFileExtensions: ["js", "json", "node"]
};
