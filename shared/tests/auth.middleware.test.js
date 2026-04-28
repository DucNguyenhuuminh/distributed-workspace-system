const jwt = require('jsonwebtoken');
const { authMiddleware, verifyToken } = require('../middlewares/auth.middleware');

// Mock thư viện jsonwebtoken
jest.mock('jsonwebtoken');

describe('Auth Middlewares', () => {
  let req, res, next;

  beforeEach(() => {
    // Reset mock objects trước mỗi test case
    req = {
      headers: {}
    };
    res = {
      status: jest.fn().mockReturnThis(), // Cho phép chain res.status().json()
      json: jest.fn()
    };
    next = jest.fn();
    
    // Cài đặt biến môi trường ảo
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // Test cho hàm authMiddleware
  // ═══════════════════════════════════════════════════════════
  describe('authMiddleware', () => {
    test('❌ Thiếu header authorization → 401', () => {
      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Missing token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('❌ Format token không bắt đầu bằng Bearer → 401', () => {
      req.headers.authorization = 'Basic some-token';
      
      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Missing token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('❌ Token không hợp lệ hoặc hết hạn → 401', () => {
      req.headers.authorization = 'Bearer invalid-token';
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      authMiddleware(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('invalid-token', 'test-secret');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('✅ Token hợp lệ → gắn req.user và gọi next()', () => {
      req.headers.authorization = 'Bearer valid-token';
      const mockDecoded = { userId: 'user-123', role: 'ADMIN' };
      jwt.verify.mockReturnValue(mockDecoded);

      authMiddleware(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(req.user).toEqual(mockDecoded);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Test cho hàm verifyToken
  // ═══════════════════════════════════════════════════════════
  describe('verifyToken', () => {
    test('❌ Không có header authorization → 401', () => {
      verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'No token provided' });
      expect(next).not.toHaveBeenCalled();
    });

    test('❌ Có Bearer nhưng chuỗi đằng sau rỗng → 401', () => {
      req.headers.authorization = 'Bearer '; // split ra mảng rỗng ở index 1
      
      verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'No token provided' });
      expect(next).not.toHaveBeenCalled();
    });

    test('❌ Token không hợp lệ hoặc hết hạn → 401', () => {
      req.headers.authorization = 'Bearer expired-token';
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('✅ Token hợp lệ → gắn req.user và gọi next()', () => {
      req.headers.authorization = 'Bearer good-token';
      const mockDecoded = { userId: 'user-456' };
      jwt.verify.mockReturnValue(mockDecoded);

      verifyToken(req, res, next);

      expect(req.user).toEqual(mockDecoded);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});