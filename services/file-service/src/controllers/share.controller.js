const axios = require('axios');
const Document = require('../models/documents.model');
const ShareLink = require('../models/share.model');

async function validateShareLink(token) {
    console.log(`[ShareController] Validating token: ${token}`);
    const shareLink = await ShareLink.findOne({token});

    if (!shareLink) {
        console.warn(`[ShareController] Validation failed: Token ${token} not found`);
        return {error: 404, message: 'Share link not found'};
    }
    if (shareLink.isRevoked) {
        console.warn(`[ShareController] Validation failed: Token ${token} has been manually revoked`);
        return {error: 403, message: 'Share link has been revoked'};
    }
    if (shareLink.expiredAt && new Date() > shareLink.expiredAt) {
        console.warn(`[ShareController] Validation failed: Token ${token} has expired`);
        return {error: 403, message: 'Share link has expired'};
    }
    console.log(`[ShareController] Token ${token} is valid`);
    return {shareLink};
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
            console.warn(`[ShareController] Create link failed: File ${fileId} not found`);
            return res.status(404).json({ message: 'File not found' });
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[ShareController] Create link failed: User ${userId} is not the owner of personal file ${fileId}`);
                return res.status(403).json({ message: 'Only file owner can create share link' });
            }
        }else {
            try {
                const Ws = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}}
                );
                const member = Ws.data.data.members.find((m) => m.userId.toString() === userId);
                if (!member || member.role !== 'ADMIN') {
                    console.warn(`[ShareController] Create link failed: User ${userId} is not Admin in workspace ${file.workspaceId}`);
                    return res.status(403).json({ message: 'Only workspace Admin can share files' });
                }
            } catch(err) {
                console.error(`[ShareController] Failed to connect to workspace service for permissions:`, err.message);
                return res.status(500).json({ message: 'Cannot connect to workspace-service' });
            }
        }

        const expiredAt = expiresInHours ? new Date(Date.now() + parseInt(expiresInHours)*3600*1000):null;

        const shareLink = await ShareLink.create({
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

        const shareUrl = `${process.env.FRONTEND_URL}/share/${shareLink.token}`;
        console.log(`[ShareController] Successfully created share link. Token: ${shareLink.token}`);

        return res.status(201).json({
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
        console.error(`[ShareController] System error in createShareLink:`, err.message);
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

        console.log(`[ShareController] Successfully fetched shared file details for token: ${token}`);
        return res.json({
            message: 'Share link validate',
            data: {
                permissions: shareLink.permissions,
                expiredAt: shareLink.expiredAt,
                hasPassword: !!shareLink.password, // Ensure boolean is returned
                settings: shareLink.settings,
                fileName: shareLink.fileName,
                fileSize: shareLink.fileSize,
                mimeType: shareLink.mimeType
            },
        });
    } catch(err) {
        console.error(`[ShareController] System error in getSharedFile:`, err.message);
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
            console.log(`[ShareController] No password required for token: ${token}`);
            return res.json({message: 'No password required', verified: true});
        }
        
        const isMatch = await shareLink.verifyPassword(password);
        if (!isMatch) {
            console.warn(`[ShareController] Verify failed: Incorrect password for token ${token}`);
            return res.status(401).json({message: 'Incorrect password', verified: false});
        }

        console.log(`[ShareController] Password successfully verified for token: ${token}`);
        return res.json({message: 'Password verified', verified: true});
    } catch(err) {
        console.error(`[ShareController] System error in verifySharePassword:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//--------POST /api/files/share/:token/access----------
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
                console.warn(`[ShareController] Access denied: Password incorrect or missing for token ${token}`);
                return res.status(401).json({message: 'Password required or incorrect'});
            }
        }
        
        if (!shareLink.permissions.includes(action)) {
            console.warn(`[ShareController] Access denied: Action '${action}' not listed in allowed permissions`);
            return res.status(403).json({
                message: `Action ${action} not allowed`,
                allowed: shareLink.permissions
            });
        }
        
        if (action === 'download' && !shareLink.settings.allowedDownload) {
            console.warn(`[ShareController] Access denied: Download explicitly disabled in settings`);
            return res.status(403).json({message: 'Download is disabled for this link'});
        }

        const document = await Document.findById(shareLink.fileId).populate('physicalFileId', 'minioObjectPath sizeBytes mimeType');
        if (!document) {
            console.warn(`[ShareController] Access failed: Underlying document ${shareLink.fileId} no longer exists`);
            return res.status(404).json({ message: 'File not found' });
        }

        console.log(`[ShareController] Calling Storage Service to generate presigned URL for access`);
        const presignedURL = await axios.get(`${process.env.STORAGE_SERVICE_URL}/api/storage/file/url`,
            {params: {
                objectName: document.physicalFileId.minioObjectPath,
                originalName: document.originalName,
                action: action === 'download' ? 'download':'view'
            }}
        );

        if (shareLink.settings.notifyOnAccess) {
            console.log(`[ShareController] (Mock) Notification triggered for file access on token ${token}`);
        } else {
            console.log(`[ShareController] User ${userId} successfully accessed ${token} with action: ${action}`);
        }

        return res.json({
            message: 'Access link successfully',
            data: {
                url: presignedURL.data.data.url,
                fileName: shareLink.fileName,
                fileSize: shareLink.fileSize,
                mimeType: shareLink.mimeType,
                permissions: shareLink.permissions
            }
        });
    } catch(err) {
        console.error(`[ShareController] System error in accessSharedFile:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//--------POST /api/files/share/:token/save----------
async function saveShareFile(req,res) {
    try {
        const {token} = req.params;
        const {folderId, password} = req.body;
        const userId = req.user.userId;

        const {error, message, shareLink} = await validateShareLink(token);
        if (error) {
            return res.status(error).json({message});
        }

        if (shareLink.password) {
            const isMatch = await shareLink.verifyPassword(password || '');
            if (!isMatch) {
                console.warn(`[ShareController] Save denied: Password incorrect or missing`);
                return res.status(401).json({message: 'Password required or incorrect'});
            }
        }
        
        if(!shareLink.permissions.includes('save')) {
            console.warn(`[ShareController] Save denied: 'save' permission not granted`);
            return res.status(403).json({message: 'This link does not allow saving'});
        }
        
        if (!shareLink.settings?.allowedSave) {
            console.warn(`[ShareController] Save denied: Save explicitly disabled in settings`);
            return res.status(403).json({message: 'Save is disabled for this link'});
        }

        const originalDoc = await Document.findById(shareLink.fileId).populate('physicalFileId');
        if (!originalDoc) {
            console.warn(`[ShareController] Save failed: Original file no longer exists`);
            return res.status(403).json({message: 'Original file not found'});
        }
        
        if (originalDoc.uploadedBy.toString() === userId) {
            console.warn(`[ShareController] Save blocked: User trying to save their own file`);
            return res.status(403).json({message: 'Cannot save your own file'});
        }
        
        const alreadySaved = await Document.findOne({
            physicalFileId: originalDoc.physicalFileId,
            uploadedBy: userId,
            workspaceId: null,
        });

        if (alreadySaved) {
            console.warn(`[ShareController] Save blocked: User already saved this file previously. DocID: ${alreadySaved._id}`);
            return res.status(409).json({
                message: 'File already saved',
                data: {documentId: alreadySaved._id}
            });
        }

        const newDocument = await Document.create({
            originalName: originalDoc.originalName,
            workspaceId: null,
            folderId: folderId || null,
            physicalFileId: originalDoc.physicalFileId._id,
            uploadedBy: userId
        });

        console.log(`[ShareController] Successfully saved shared file to user's space. New DocID: ${newDocument._id}`);
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
        console.error(`[ShareController] System error in saveShareFile:`, err.message);
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
            console.warn(`[ShareController] Revoke failed: Token not found`);
            return res.status(404).json({ message: 'Share link not found' });
        }
        
        if (share.createdBy.toString() !== userId) {
            console.warn(`[ShareController] Revoke denied: User ${userId} is not the creator of the token`);
            return res.status(403).json({ message: 'Only link creator can revoke it' });
        }
        
        share.isRevoked = true;
        await share.save();

        console.log(`[ShareController] Successfully revoked token ${token}`);
        return res.json({message: 'Share link revoked successfully'});
    } catch(err) {
        console.error(`[ShareController] System error in revokeShareLink:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//--------GET /api/files/:id/share----------
async function getShareLinks(req,res) {
    try {
        const fileId = req.params.id;
        const userId = req.user.userId;

        const share = await ShareLink.find({fileId, createdBy: userId}).select('-password').sort({createdAt: -1});
        
        console.log(`[ShareController] Successfully fetched ${share.length} active/revoked share links`);
        return res.json({data: share});
    } catch(err) {
        console.error(`[ShareController] System error in getShareLinks:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    createShareLink,
    getSharedFile,
    verifySharePassword,
    accessSharedFile,
    saveShareFile,
    getShareLinks,
    revokeShareLink
}