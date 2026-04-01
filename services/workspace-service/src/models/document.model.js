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
        required: true,
    },
    uploadedBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    processedStatus:{
        type: String,
        enum: ["PENDING","PROCESSING","DONE","FAILED"],
        default: "PENDING",
    },
},{timestamps: true});

module.exports = mongoose.model("Documents", documentSchema);