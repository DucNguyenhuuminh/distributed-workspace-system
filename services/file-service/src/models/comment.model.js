const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    fileId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Documents',
        required: true,
        index: true
    },
    content:{
        type: String,
        required: true,
        trim: true,
        maxLength: 2000,
    },
    createdBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comments',
        default: null,
        index: true
    },
    deletedAt:{
        type: Date,
        default: null,
    },
},{timestamps: true});

commentSchema.pre(/^find/, function(){
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model('Comments', commentSchema);