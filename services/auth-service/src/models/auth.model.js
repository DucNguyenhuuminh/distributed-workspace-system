const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        email:{
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        password:{
            type: String,
            required: true,
            trim: true,
        },
        username:{
            type: String,
            required: true,
            trim: true
        },
        globalRole:{
           type: String,
           enum: ['USER','SYSTEM_ADMIN'],
           default: 'USER' 
        },
        isActive:{
            type: Boolean,
            default: true
        },
    },
    {timestamps: true}
);

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next;
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

userSchema.methods.comparePassword = function (plainPassword) {
    return bcrypt.compare(plainPassword, this.password);
};

userSchema.methods.toJson = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

module.exports = mongoose.model("Users", userSchema);
