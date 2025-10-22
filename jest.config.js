module.exports = {
  testEnvironment: 'node',
  
  // Look for tests in both src/ and tests/ directories
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  
  // Test file patterns - supports co-located tests
  testMatch: [
    '**/__tests__/**/*.js',           // Traditional __tests__ folders
    '**/?(*.)+(spec|test).js'         // Co-located .test.js or .spec.js files
  ],
  
  // Coverage collection
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',              // Exclude test files from coverage
    '!src/**/*.spec.js',              // Exclude spec files from coverage
    '!src/**/index.js',               // Exclude index files (usually just exports)
  ],
  
  // Coverage output
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  
  // Test setup
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Verbose output for better debugging
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Collect coverage from all files, not just tested ones
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/**/index.js',
    '!**/node_modules/**'
  ]
};
