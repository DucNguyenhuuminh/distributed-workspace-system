const axios = require('axios');
const Document = require('../models/documents.model');
const ShareLink = require('../models/share.model');

async function validateShareLink(token) {
    const share = await ShareLink.findOne({token});

    if (!share) {
        return {error: 404, message: 'Share link not found'};
    }
    if (share.isRevoked) {
        return {error: 403, message: 'Share link has been revoked'};
    }
    if (share.expiredAt && new Date() > share.expiredAt) {
        return {error: 403, message: 'Share link has expired'};
    }
    return {share};
}

//--------POST /api/files/:id/share----------
async function createShareLink(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const {
            permissions = ['view'],
            expiresInHours = null,
            password = null,
            settings = {},
        } = req.body;

        const file = await Document.findById(fileId).populate('physicalFileId', 'sizeBytes mimeType');
        if (!file) {
            return res.status(404).json({ message: 'File not found' });
        }
        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                return res.status(403).json({ message: 'Only file owner can create share link' });
            }
        }else {
            try {
                Ws = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authentication: req.headers.authentication}}
                );
                const member = Ws.data.data.members.find((m) => m.userId.toString() === userId);
                if (!member || member.role !== 'ADMIN') {
                    return res.status(403).json({ message: 'Only workspace Admin can share files' });
                }
            } catch(err) {
                return res.status(500).json({ message: 'Cannot connect to workspace-service' });
            }
        }

        const expiredAt = expiresInHours ? new Date(Date.now() + parseInt(expiresInHours)*3600):null;

        const share = await ShareLink.create({
            fileId,
            workspaceId: file.workspaceId || null,
            createdBy: userId,
            permissions,
            password,
            settings: {
                allowedDownload: settings.allowedDownload ?? true,
                allowedSave: settings.allowedSave ?? true,
                notifyOnAccess: settings.notifyOnAccess ?? false,
            },
            fileName: file.originalName,
            fileSize: file.physicalFileId?.sizeBytes,
            mimeType: file.physicalFileId.mimeType
        });

        const shareUrl = `${process.env.FRONTEND_URL}/share/${share.token}`;

        return res.json({
            message: 'Share link created successfully',
            data: {
                token:       shareLink.token,
                shareUrl,
                permissions: shareLink.permissions,
                expiredAt:   shareLink.expiredAt,
                hasPassword: !!shareLink.password,
                settings:    shareLink.settings,
                fileName:    shareLink.fileName,
                fileSize:    shareLink.fileSize,
                mimeType:    shareLink.mimeType,
            },
        });
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

//--------GET /api/files/share/:token----------
async function getSharedFile(req,res) {
    try {
        const {token} = req.params;

        const {error, message, shareLink} = await validateShareLink(token);
        if (error) {
            return res.status(error).json({message});
        }

        return res.json({
            message: 'Share link validate',
            data: {
                permissions: shareLink.permissions,
                expiredAt: shareLink.expiredAt,
                hasPassword: shareLink.password,
                settings: shareLink.settings,
                fileName: shareLink.fileName,
                fileSize: shareLink.fileSize,
                mimeType: shareLink.mimeType
            },
        });
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

//--------POST /api/files/share/:token/verify----------
async function verifySharePassword(req,res) {
    try {
        const {token} = req.params;
        const {password} = req.body;

        const {error, message, shareLink} = await validateShareLink(token);
        if (error) {
            return res.status(error).json({message});
        }

        if (!shareLink.password) {
            return res.json({message: 'No password required', verified: true});
        }
        const isMatch = await shareLink.verifyPassword(password);
        if (!isMatch) {
            return res.status(401).json({message: 'Incorrect password', verified: false});
        }

        return res.json({message: 'Password verified', verified: true});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//--------GET /api/files/share/:token/access----------
async function accessSharedFile(req,res) {
    try {
        const {token} = req.params;
        const {action = 'view', password} = req.body;
        const userId = req.user.userId;

        const {error, message, shareLink} = await validateShareLink(token);
        if (error) {
            return res.status(error).json({message});
        }

        if (shareLink.password) {
            const isMatch = await shareLink.verifyPassword(password);
            if (!isMatch) {
                return res.status(401).json({message: 'Password required or incorrect'});
            }
        }
        if (!shareLink.permissions.includes(action)) {
            return res.status(403).json({
                message: `Action ${action} not allowed`,
                allowed: shareLink.permissions
            });
        }
        if (action === 'download' && !shareLink.settings.allowedDownload) {
            return res.status(403).json({message: 'Download is disabled for this link'});
        }

        const document = await Document.findById(shareLink.fileId).populate('physicalFileId', 'minioObjectPath sizeBytes mimeType');
        if (!document) {
            return res.status(404).json({ message: 'File not found' });
        }

        const presignedURL = await axios.get(`${process.env.STORAGE_SERVICE_URL}/api/storage/file/url`,
            {params: {
                objectName: document.physicalFileId.minioObjectPath,
                originalName: document.originalName,
                action: action === 'download' ? 'download':'view'
            }}
        );

        if (!shareLink.settings.notifyOnAccess) {
            console.log(`[ShareLink] ${userId} accessed ${shareLink.token} with action: ${action}`);
        }

        return res.json({
            message: 'Access link successfully',
            data: {
                url: presignedURL.data.data.url,
                fileName: shareLink.originalName,
                fileSize: shareLink.fileSize,
                mimeType: shareLink.mimeType,
                permissions: shareLink.permissions
            }
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//--------POST /api/files/share/:token/save----------
async function saveShareLink(req,res) {
    try {
        const {token} = req.params;
        const {folderId, password} = req.body;
        const userId = req.user.userId;

        const {error, message, shareLink} = await validateShareLink(token);
        if (error) {
            return res.status(error).json({message});
        }

        if (shareLink.password) {
            const isMatch = await ShareLink.verifyPassword(password);
            if (!isMatch) {
                return res.status(401).json({message: 'Password required or incorrect'});
            }
        }
        if(!shareLink.permissions.includes('save')) {
            return res.status(403).json({message: 'This link does not allow saving'});
        }
        if (!shareLink.settings?.allowedSave) {
            return res.status(403).json({message: 'Save is disabled for this link'});
        }

        const originalDoc = await Document.findById(shareLink.fileId).populate('physicalFileId');
        if (!originalDoc) {
            return res.status(403).json({message: 'Original file not found'});
        }
        if (originalDoc.uploadedBy.toString() === userId) {
            return res.status(403).json({message: 'Cannot save your own file'});
        }
        
        const alreadySaved = await Document.findOne({
            physicalFileId: originalDoc.physicalFileId,
            uploadedBy: userId,
            workspaceId: null,
        });

        if (alreadySaved) {
            return res.status(409).json({
                message: 'File already saved',
                data: {documentId: areadySaved._id}
            });
        }

        const newDocument = await Document.create({
            originalName: originalDoc.originalName,
            workspaceId: null,
            folderId: folderId || null,
            physicalFileId: originalDoc.physicalFileId._id,
            uploadedBy: userId
        });

        return res.status(201).json({
            message: 'File save into your space',
            data: {
                documentId: newDocument._id,
                originalName: newDocument.originalName,
                mimeType: newDocument.mimeType,
                sizeBytes: newDocument.sizeBytes
            }
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//--------DELETE /api/files/:id/share/:token----------
async function revokeShareLink(req,res) {
    try {
        const userId = req.user.userId;
        const {id,token} = req.params;

        const share = await ShareLink.findOne({token, fileId: id});
        if (!share) {
            return res.status(404).json({ message: 'Share link not found' });
        }
        if (share.createdBy.toString() !== userId) {
            return res.status(403).json({ message: 'Only link creator can revoke it' });
        }
        share.isRevoked = true;
        await share.save();

        return res.json({message: 'Share link revoked successfully'});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//--------GET /api/files/:id/share----------
async function getShareLinks(req,res) {
    try {
        const fileId = req.params.id;
        const userId = req.user.userId;

        const share = await ShareLink.find({fileId, createdBy: userId}).select('-password').sort({createdAt: -1});
        return res.json({data: share});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    createShareLink,
    getSharedFile,
    verifySharePassword,
    accessSharedFile,
    saveShareLink,
    getShareLinks,
    revokeShareLink
}