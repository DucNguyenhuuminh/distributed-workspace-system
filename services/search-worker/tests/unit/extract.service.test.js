const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const extractService = require('../../src/services/extract.service');

jest.mock('axios');
jest.mock('pdf-parse', () => jest.fn());
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));

describe('Extract Service', () => {
  
  describe('isSupportedMime', () => {
    test('✅ Trả về true cho PDF và Word', () => {
      expect(extractService.isSupportedMime('application/pdf')).toBe(true);
      expect(extractService.isSupportedMime('text/plain')).toBe(true);
    });

    test('❌ Trả về false cho định dạng lạ', () => {
      expect(extractService.isSupportedMime('video/mp4')).toBe(false);
    });
  });

  describe('downloadFile', () => {
    test('✅ Tải file thành công dạng Buffer', async () => {
      // Mock call 1: Get presigned URL
      axios.get.mockResolvedValueOnce({ data: { data: { url: 'http://minio/file' } } });
      // Mock call 2: Download actual file
      axios.get.mockResolvedValueOnce({ data: Buffer.from('mock-data') });

      const buffer = await extractService.downloadFile('my-object.pdf');
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('extractText', () => {
    const mockBuffer = Buffer.from('mock');

    test('✅ Extract PDF', async () => {
      pdfParse.mockResolvedValueOnce({ text: '  Hello PDF  ' });
      const text = await extractService.extractText(mockBuffer, 'application/pdf');
      expect(text).toBe('Hello PDF'); // Đã trim()
    });

    test('✅ Extract DOCX', async () => {
      mammoth.extractRawText.mockResolvedValueOnce({ value: '  Hello DOCX  ' });
      const text = await extractService.extractText(mockBuffer, 'application/msword');
      expect(text).toBe('Hello DOCX');
    });

    test('✅ Extract TXT', async () => {
      const txtBuffer = Buffer.from('  Hello TXT  ');
      const text = await extractService.extractText(txtBuffer, 'text/plain');
      expect(text).toBe('Hello TXT');
    });

    test('❌ Trả về null nếu mimetype không xác định', async () => {
      const text = await extractService.extractText(mockBuffer, 'image/png');
      expect(text).toBeNull();
    });

    test('❌ Trả về null nếu text trống', async () => {
      pdfParse.mockResolvedValueOnce({ text: '   ' });
      const text = await extractService.extractText(mockBuffer, 'application/pdf');
      expect(text).toBeNull();
    });
  });
});