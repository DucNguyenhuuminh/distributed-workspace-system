const DocumentMock = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(), 
  collection: {
    findOne: jest.fn()  
  }
};

const PhysicalFileMock = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
};

// Hàm Factory tạo Mock Data tránh rò rỉ trạng thái (State Mutation)
const getFreshDocument = (overrides = {}) => ({
  _id: '60d5ec49f1b2c8a1b4e1d3a1', 
  originalName: 'test.pdf',
  workspaceId: null,
  folderId: null,
  uploadedBy: 'user-001',
  physicalFileId: { minioObjectPath: 'file/test.pdf' },
  save: jest.fn().mockResolvedValue(true),
  toObject: jest.fn().mockReturnValue({}),  
  ...overrides,
});

const getFreshPhysicalFile = (overrides = {}) => ({
  _id: 'phys-123',
  hashString: 'mock-hash-string',
  minioObjectPath: 'file/test.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  ...overrides,
});

module.exports = { 
  DocumentMock, 
  PhysicalFileMock, 
  getFreshDocument, 
  getFreshPhysicalFile 
};