// Giả lập toàn bộ MinIO — không cần MinIO thật khi test
const mockMinioClient = {

  // Giả lập initiateNewMultipartUpload
  initiateNewMultipartUpload: jest.fn(),

  // Giả lập presignedUrl
  presignedUrl: jest.fn(),

  // Giả lập completeMultipartUpload
  completeMultipartUpload: jest.fn(),

  // Giả lập bucketExists
  bucketExists: jest.fn().mockResolvedValue(true),
};

const BUCKET_NAME = 'test-bucket';

module.exports = { minioClient: mockMinioClient, BUCKET_NAME};