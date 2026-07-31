export default {
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "<rootDir>/tsconfig.json" }]
  }
};
