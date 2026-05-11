const { validationResult } = require('express-validator');
const { validateRequest } = require('../../middlewares/validate.middleware');

// Mock thư viện express-validator
jest.mock('express-validator', () => ({
  validationResult: jest.fn()
}));

describe('Validate Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('✅ Không có lỗi validate → gọi next()', () => {
    // Giả lập validationResult trả về isEmpty() = true
    validationResult.mockReturnValue({
      isEmpty: () => true
    });

    validateRequest(req, res, next);

    expect(validationResult).toHaveBeenCalledWith(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('❌ Có lỗi validate → Format lại lỗi và trả về 400', () => {
    // Giả lập validationResult trả về một mảng chứa các lỗi
    const mockErrors = [
      { path: 'email', msg: 'Email is required' },
      { path: 'password', msg: 'Password must be string' }
    ];

    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => mockErrors
    });

    validateRequest(req, res, next);

    expect(validationResult).toHaveBeenCalledWith(req);
    
    // Kiểm tra API trả về mã lỗi 400
    expect(res.status).toHaveBeenCalledWith(400);
    
    // Kiểm tra định dạng extractedErrors có được map đúng dạng { [path]: msg } không
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: [
        { email: 'Email is required' },
        { password: 'Password must be string' }
      ]
    });
    
    // Đảm bảo request không đi tiếp vào controller
    expect(next).not.toHaveBeenCalled();
  });
});