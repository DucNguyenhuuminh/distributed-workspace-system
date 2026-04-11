const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    hashString:{
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    minioObjectPath:{
        type: String,
        require: true,
    },
    sizeBytes:{
        type: Number,
        required: true,
    },
    mimeType:{
        type: String,
        required: true,
    },
},{timestamps: true});

module.exports = mongoose.model("PhysicalFiles",fileSchema);