const mongoose           = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

// Khởi động MongoDB in-memory trước khi chạy test
async function connectTestDB() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

// Xóa toàn bộ data sau mỗi test
async function clearTestDB() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

// Đóng kết nối sau khi test xong
async function closeTestDB() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
}

module.exports = { connectTestDB, clearTestDB, closeTestDB };