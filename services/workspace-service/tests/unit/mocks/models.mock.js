const getFreshFolder = (overrides = {}) => ({
  _id:         '648000000000000000000001',
  name:        'Test Folder',
  workspaceId: null,
  ownerId:     'user-001',
  parentId:    null,
  createdBy:   { toString: () => 'user-001' },
  deletedAt:   null,
  save:        jest.fn().mockResolvedValue(true),
  toObject:    jest.fn().mockReturnValue({}),
  ...overrides, // Cho phép ghi đè các thuộc tính khi cần
});

const getFreshWorkspace = (overrides = {}) => ({
  _id:        '648000000000000000000002',
  name:       'Test Workspace',
  createdBy:  'user-001',
  deletedAt:  null,
  members: [
    {
      userId:      { toString: () => 'user-001' },
      role:        'ADMIN',
      permissions: 'editor', // Sử dụng string cho khớp với validator mới
    },
    {
      userId:      { toString: () => 'user-002' },
      role:        'MEMBER',
      permissions: 'viewer',
    },
  ],
  save:       jest.fn().mockResolvedValue(true),
  toObject:   jest.fn().mockReturnValue({}),
  ...overrides,
});

// ── Model Mocks ────────────────────────────────────────────
// Mock các hàm query của Mongoose

const FolderMock = {
  findById:   jest.fn(),
  find:       jest.fn(),
  create:     jest.fn(),
  updateMany: jest.fn(),
};

const WorkspaceMock = {
  findById: jest.fn(),
  create:   jest.fn(),
  find:     jest.fn(),
};

module.exports = {
  getFreshFolder,
  getFreshWorkspace,
  FolderMock,
  WorkspaceMock,
};