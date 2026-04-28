// tests/mocks/shared.mock.js
module.exports = {
  addJob: jest.fn().mockResolvedValue({ id: 'job-mock-id' }),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  EVENTS: {
    FILE_UPLOAD: 'file.upload',
    FILE_MERGED: 'file.merged',
  },
};