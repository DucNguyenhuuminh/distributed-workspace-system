const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const shareLinkSchema = new mongoose.Schema({
    fileId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: documentSchema,
        require: true,
        index: true
    },
    workspacId:{
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    createdBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    token:{
        type: String,
        required: true,
        unique: true,
        index: true,
        default: () => crypto.randomBytes(32).toString('hex')
    },
    permissions:{
        type: [String],
        enum: ['view', 'download', 'save'],
        default: ['view']
    },
    expiredAt:{
        type: Date,
        default: null
    },
    password:{
        type: String,
        default: null
    },
    isRevoked: {
      type:    Boolean,
      default: false,
    },
    fileName: {
        type: String,
        default: null
    },
    fileSize: {
        type: Number,
        default: null
    },
    mimeType: {
        type: String,
        default: null
    },
    settings:{
        type: {
            allowedDownload: {type: Boolean, default: true},
            allowedSave: {type: Boolean, default: true},
            notifyOnAccess: {type: Boolean, default: false},
        },
        default: () => ({})
    }
}, {timestamps: true});

shareLinkSchema.index(
    {expiredAt: 1},
    {expireAfterSeconds: 7*24*3600, sparse: true}
);

shareLinkSchema.pre('save', async function (next) {
    if (this.isModified('password') && this.password) {
        this.password = await bcrypt.hash(this.password,10);
    }
    next();
});

shareLinkSchema.methods.verifyPassword = function (plain) {
    if (!this.password) {
        return true;
    }
    return bcrypt.compare(plain, this.password);
}

module.exports = mongoose.model('ShareLink', shareLinkSchema);