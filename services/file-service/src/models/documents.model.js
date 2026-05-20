const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
    originalName:{
        type: String,
        required: true,
        trim: true,
    },
    workspaceId:{
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    folderId:{
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    physicalFileId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PhysicalFiles',
        required: true,
    },
    uploadedBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    isDuplicate:{
        type: Boolean,
        default: false,
    },
    deletedAt:{
        type: Date,
        default: null
    },
},{timestamps: true});

documentSchema.pre(/^find/,function() {
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model("Documents",documentSchema);