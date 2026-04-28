const mockMinioClient = {
  initiateNewMultipartUpload: jest.fn(),
  presignedUrl:               jest.fn(),
  completeMultipartUpload:    jest.fn(),
  presignedGetObject:         jest.fn(),
  removeObject:               jest.fn(),
  bucketExists:               jest.fn().mockResolvedValue(true),
  makeBucket:                 jest.fn().mockResolvedValue(true),
};

module.exports = {
  minioClient: mockMinioClient,
  bucketName:  'test-bucket',
};