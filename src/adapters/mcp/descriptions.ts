/*
 * Tool prose lives apart from registration so wording can be reviewed and
 * revised independently. Each description must stay under 2048 characters;
 * its first 500 must explain purpose, when to use it, and required arguments.
 */
export const GENERATE_DESCRIPTION =
  'Ambercast generate: generates or creates new test files based on your requirements. ' +
  'Use this when you need to create test files from scratch. ' +
  'No arguments required; empty object {} targets all files.';

export const RUN_DESCRIPTION =
  'Ambercast run: runs or replays existing test files to verify their behavior. ' +
  'Use this to execute tests and see results. ' +
  'No arguments required; empty object {} targets all files.';

export const CHECK_DESCRIPTION =
  'Ambercast check: validates or checks test files for correctness and completeness. ' +
  'Use this to verify test integrity without running them. ' +
  'No arguments required; empty object {} targets all files.';

export const HEAL_DESCRIPTION =
  'Ambercast heal: repairs or fixes broken test files automatically. ' +
  'Use this when tests fail and need automatic repair. ' +
  'No arguments required; empty object {} targets all files. ' +
  'Requires user interaction to apply changes.';
