const Resource = require('../models/Resource');
const Question = require('../models/Question');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);
const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

function safeFileName(name) {
  return String(name || 'resource').replace(/["\r\n]/g, '_');
}

function getLibreOfficePath() {
  return process.env.LIBREOFFICE_PATH ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
      : 'soffice');
}

async function getStoredFile(resource) {
  if (!resource || !resource.storagePath) {
    const error = new Error('Document not found.');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  const absolutePath = path.resolve(resource.storagePath);
  const uploadRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
  if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    const error = new Error('The stored file path is invalid.');
    error.statusCode = 400;
    error.code = 'INVALID_FILE_PATH';
    throw error;
  }
  await fs.promises.access(absolutePath, fs.constants.R_OK);
  return absolutePath;
}

async function getPreviewFile(resource, sourcePath) {
  const extension = path.extname(resource.originalName || sourcePath).toLowerCase();
  if (!OFFICE_EXTENSIONS.has(extension) && !OFFICE_MIME_TYPES.has(resource.mimeType)) {
    return { filePath: sourcePath, mimeType: resource.mimeType || 'application/octet-stream', fileName: resource.originalName || resource.fileName };
  }

  const previewDir = path.join(__dirname, '..', 'uploads', '.previews');
  const previewPath = path.join(previewDir, `${resource.fileName}.pdf`);
  await fs.promises.mkdir(previewDir, { recursive: true });
  try {
    await fs.promises.access(previewPath, fs.constants.R_OK);
    return { filePath: previewPath, mimeType: 'application/pdf', fileName: `${path.basename(resource.originalName, extension)}.pdf` };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const conversionDir = await fs.promises.mkdtemp(path.join(previewDir, 'conversion-'));
  const profileDir = await fs.promises.mkdtemp(path.join(previewDir, 'profile-'));
  try {
    await execFileAsync(getLibreOfficePath(), [
      '--headless',
      `-env:UserInstallation=${pathToFileUrl(profileDir)}`,
      '--convert-to', 'pdf',
      '--outdir', conversionDir,
      sourcePath
    ], { windowsHide: true, timeout: 120000 });
    const generatedFiles = await fs.promises.readdir(conversionDir);
    const generatedPdf = generatedFiles.find((fileName) => path.extname(fileName).toLowerCase() === '.pdf');
    if (!generatedPdf) throw new Error('LibreOffice did not produce a PDF file.');
    await fs.promises.copyFile(path.join(conversionDir, generatedPdf), previewPath);
  } catch (error) {
    return { filePath: sourcePath, mimeType: resource.mimeType || 'application/octet-stream', fileName: resource.originalName || resource.fileName };
  } finally {
    await fs.promises.rm(conversionDir, { recursive: true, force: true });
    await fs.promises.rm(profileDir, { recursive: true, force: true });
  }
  await fs.promises.access(previewPath, fs.constants.R_OK);
  return { filePath: previewPath, mimeType: 'application/pdf', fileName: `${path.basename(resource.originalName, extension)}.pdf` };
}

function pathToFileUrl(directory) {
  return `file:///${path.resolve(directory).replace(/\\/g, '/')}`;
}

function serializeResource(resource) {
  return {
    id: String(resource._id),
    title: resource.title,
    description: resource.description,
    category: resource.category,
    branch: resource.branch || '',
    url: resource.url || '',
    questionCount: resource.questionCount || 0,
    file: resource.fileName ? {
      name: resource.originalName,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      size: resource.fileSize,
      previewUrl: `/api/resources/${resource._id}/preview`,
      downloadUrl: `/api/resources/${resource._id}/download`
    } : null,
    uploadedBy: resource.uploadedBy && typeof resource.uploadedBy === 'object'
      ? {
          id: String(resource.uploadedBy._id),
          fullName: resource.uploadedBy.fullName,
          role: resource.uploadedBy.role,
          email: resource.uploadedBy.email
        }
      : resource.uploadedBy || null,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    isActive: resource.isActive
  };
}

async function listResources(req, res, next) {
  try {
    const query = { isActive: true };
    if (req.query.branch) query.branch = String(req.query.branch).trim();
    const search = req.query.q || req.query.search || req.query.query;
    if (search) {
      const expression = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ title: expression }, { description: expression }, { category: expression }, { originalName: expression }];
    }
    const resources = await Resource.find(query)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'fullName role email');

    const questionCounts = await Question.aggregate([
      { $match: { resource: { $in: resources.map((resource) => resource._id) } } },
      { $group: { _id: '$resource', count: { $sum: 1 } } }
    ]);
    const countsByResource = new Map(questionCounts.map((item) => [String(item._id), item.count]));
    resources.forEach((resource) => { resource.questionCount = countsByResource.get(String(resource._id)) || 0; });

    return res.status(200).json({
      success: true,
      resources: resources.map(serializeResource)
    });
  } catch (error) {
    return next(error);
  }
}

async function listMyResources(req, res, next) {
  try {
    const query = { uploadedBy: req.user._id, isActive: true };
    if (req.query.search) {
      const expression = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ title: expression }, { description: expression }, { category: expression }, { originalName: expression }];
    }
    const resources = await Resource.find(query)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'fullName role email');

    const questionCounts = await Question.aggregate([
      { $match: { resource: { $in: resources.map((resource) => resource._id) } } },
      { $group: { _id: '$resource', count: { $sum: 1 } } }
    ]);
    const countsByResource = new Map(questionCounts.map((item) => [String(item._id), item.count]));
    resources.forEach((resource) => { resource.questionCount = countsByResource.get(String(resource._id)) || 0; });

    return res.status(200).json({
      success: true,
      resources: resources.map(serializeResource)
    });
  } catch (error) {
    return next(error);
  }
}

async function createResource(req, res, next) {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || 'Notes').trim();
    const url = String(req.body.url || '').trim();

    if (!title || title.length < 3) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Resource title is required and must be at least 3 characters long.'
      });
    }

    if (!description || description.length < 10) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Resource description is required and must be at least 10 characters long.'
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please select a resource category.'
      });
    }

    const allowedCategories = ['Notes', 'Slides', 'Question Paper', 'Assignment', 'Reference Link', 'Lab Manual', 'Syllabus'];
    if (!allowedCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Unsupported resource category.'
      });
    }

    if (!url && !req.file) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please provide a resource link or URL.'
      });
    }

    const resource = await Resource.create({
      title,
      description,
      category,
      url,
      uploadedBy: req.user._id,
      branch: String(req.body.branch || req.user.branch || '').trim(),
      ...(req.file ? {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        storagePath: req.file.path
      } : {}),
      isActive: true
    });

    const populated = await resource.populate('uploadedBy', 'fullName role email');

    return res.status(201).json({
      success: true,
      message: 'Resource uploaded successfully.',
      resource: serializeResource(populated)
    });
  } catch (error) {
    return next(error);
  }

}

async function removeResource(req, res, next) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Resource not found.'
      });
    }

    if (req.user.role !== 'admin' && String(resource.uploadedBy) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You can only remove your own resources.'
      });
    }

    resource.isActive = false;
    await resource.save();

    return res.status(200).json({
      success: true,
      message: 'Resource removed successfully.'
    });
  } catch (error) {
    return next(error);
  }
}

async function previewResource(req, res, next) {
  try {
    const resource = await Resource.findOne({ _id: req.params.id, isActive: true });
    if (!resource) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Resource not found.' });
    }
    if (!resource.storagePath && resource.url) {
      return res.redirect(resource.url);
    }
    const sourcePath = await getStoredFile(resource);
    const preview = await getPreviewFile(resource, sourcePath);
    res.type(preview.mimeType);
    res.set('Content-Disposition', `inline; filename="${safeFileName(preview.fileName)}"`);
    return res.sendFile(preview.filePath);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    if (error.code === 'ENOENT' || error.code === 'EACCES') return res.status(404).json({ success: false, code: 'FILE_MISSING', message: 'The uploaded file is no longer available.' });
    return next(error);
  }
}

async function downloadResource(req, res, next) {
  try {
    const resource = await Resource.findOne({ _id: req.params.id, isActive: true });
    const sourcePath = await getStoredFile(resource);
    res.type(resource.mimeType || path.extname(sourcePath));
    return res.download(sourcePath, safeFileName(resource.originalName || resource.fileName));
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    if (error.code === 'ENOENT' || error.code === 'EACCES') return res.status(404).json({ success: false, code: 'FILE_MISSING', message: 'The uploaded file is no longer available.' });
    return next(error);
  }
}

module.exports = { listResources, listMyResources, createResource, removeResource, previewResource, downloadResource, serializeResource };
