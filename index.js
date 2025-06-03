const express = require('express');
const session = require('express-session');
const passport = require('passport');
const multer = require('multer');
const cors = require('cors');
const { google } = require('googleapis');
const OAuth2Strategy = require('passport-oauth2');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const axios = require('axios');
const stream = require('stream');
const DropboxOAuth2Strategy = require('passport-dropbox-oauth2').Strategy;

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

//allow frontend to acces this server
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));

//manage user sessions
const Redis = require('ioredis');
const RedisStore = require('connect-redis')(session);
const redisClient = new Redis('redis://default:hYEJmTXrqDgQdMSWdSSYM7abZUMVROWh@redis-13204.c338.eu-west-2-1.ec2.redns.redis-cloud.com:13204');
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: 'gdrive-onedrive',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'None'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// cloud service ids
const GOOGLE_CLIENT_ID = '790778427024-ug14f4bfbfqcd2dffinva9k742imi21v.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const MS_CLIENT_ID = 'fc7d540e-af44-4e13-a7a5-5a3266c395a6';
const MS_CLIENT_SECRET = 'kEE8Q~FYP8wG9c3Xe~l2Py5H_rVWW4sXUnks_aFD';
const DROPBOX_CLIENT_ID = 'ov0tb7xu40xarbq';
const DROPBOX_CLIENT_SECRET = 'krda01qu4lu5rwl';

// default google login handler
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://dissertation-pt8o.onrender.com/auth/google/callback',
  scope: ['profile', 'https://www.googleapis.com/auth/drive.file'],
  passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
  const user = req.user || {};
  user.google = { accessToken, profile };
  done(null, user);
}));

// default microsoft onedrive login handler
passport.use('microsoft', new OAuth2Strategy({
  authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  clientID: MS_CLIENT_ID,
  clientSecret: MS_CLIENT_SECRET,
  callbackURL: 'http://ec2-18-171-178-88.eu-west-2.compute.amazonaws.com:5000/auth/microsoft/callback',
  scope: ['https://graph.microsoft.com/Files.ReadWrite', 'offline_access'],
  passReqToCallback: true
}, async (req, accessToken, refreshToken, params, profile, done) => {
  try {
    const me = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = req.user || {};
    user.microsoft = { accessToken, profile: me.data };
    done(null, user);
  } catch (e) {
    console.error('MS fetch error:', e);
    done(e);
  }
}));

//dropbox login handler
passport.use(new DropboxOAuth2Strategy({
    apiVersion: '2',
    clientID: DROPBOX_CLIENT_ID,
    clientSecret: DROPBOX_CLIENT_SECRET,
    callbackURL: 'http://localhost:5000/auth/dropbox/callback',
    passReqToCallback: true
  }, (req, accessToken, refreshToken, profile, done) => {
    const user = req.user || {};
    user.dropbox = { accessToken, profile };
    done(null, user);
  }));  

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// google route callbacks
app.get('/auth/google', passport.authenticate('google'));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('http://localhost:3000')
);

// onedrive route callbacks
app.get('/auth/microsoft', passport.authenticate('microsoft'));
app.get('/auth/microsoft/callback',
  passport.authenticate('microsoft', { failureRedirect: '/' }),
  (req, res) => res.redirect('http://localhost:3000')
);

//dropbox route callbacks
app.get('/auth/dropbox', passport.authenticate('dropbox-oauth2'));
app.get('/auth/dropbox/callback',
  passport.authenticate('dropbox-oauth2', { failureRedirect: '/' }),
  (req, res) => res.redirect('http://localhost:3000')
);

// user login state check
app.get('/me', (req, res) => {
    res.json({
      google: !!req.user?.google,
      microsoft: !!req.user?.microsoft,
      dropbox: !!req.user?.dropbox
    });
  });  

// file uplaod handler
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.user) return res.status(401).send('Not logged in');
  
    const { buffer, originalname, mimetype } = req.file;
    const selectedTargets = JSON.parse(req.body.targets || '{}');
  
    const results = {};
    const folderName = 'File-Uploads';
  
    // upload to google drive and handle folder access or creation
    if (selectedTargets.google && req.user?.google) {
      const gStream = new stream.PassThrough();
      gStream.end(buffer);
      const gAuth = new google.auth.OAuth2();
      gAuth.setCredentials({ access_token: req.user.google.accessToken });
      const drive = google.drive({ version: 'v3', auth: gAuth });
  
      const existingFolders = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive'
      });
  
      let folderId;
      if (existingFolders.data.files.length > 0) {
        folderId = existingFolders.data.files[0].id;
      } else {
        const folder = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
          },
          fields: 'id'
        });
        folderId = folder.data.id;
      }
  
      const googleRes = await drive.files.create({
        requestBody: {
          name: originalname,
          mimeType: mimetype,
          parents: [folderId]
        },
        media: {
          mimeType: mimetype,
          body: gStream
        }
      });
  
      results.googleFileId = googleRes.data.id;
    }
  
    // upload to onedrive along with creating the app's folder
    if (selectedTargets.microsoft && req.user?.microsoft) {
      const msToken = req.user.microsoft.accessToken;
      const msRes = await axios.put(
        `https://graph.microsoft.com/v1.0/me/drive/root:/File-Uploads/${originalname}:/content`,
        buffer,
        {
          headers: {
            'Authorization': `Bearer ${msToken}`,
            'Content-Type': mimetype
          }
        }
      );
  
      results.oneDriveItemId = msRes.data.id;
    }
  
    // dropbox upload along with folder creation
    if (selectedTargets.dropbox && req.user?.dropbox) {
      await axios.post('https://content.dropboxapi.com/2/files/upload', buffer, {
        headers: {
          'Authorization': `Bearer ${req.user.dropbox.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({
            path: `/File-Uploads/${originalname}`,
            mode: 'overwrite',
            autorename: true,
            mute: false
          }),
          'Content-Type': 'application/octet-stream'
        }
      });
  
      results.dropbox = true;
    }

    res.json(results);
  });  

  // access all uploaded files
  app.get('/files', async (req, res) => {
    if (!req.user?.google && !req.user?.microsoft && !req.user?.dropbox) {
      return res.status(401).send('Login to at least one service required');
    }
  
    const folderName = 'File-Uploads';
    const allFilesMap = new Map();
  
    // access google drive files
    if (req.user?.google?.accessToken) {
      try {
        const googleAuth = new google.auth.OAuth2();
        googleAuth.setCredentials({ access_token: req.user.google.accessToken });
        const drive = google.drive({ version: 'v3', auth: googleAuth });
  
        const gFolderList = await drive.files.list({
          q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
          fields: 'files(id)',
          spaces: 'drive'
        });
  
        let gFolderId;
        if (gFolderList.data.files.length > 0) {
          gFolderId = gFolderList.data.files[0].id;
        } else {
          const newFolder = await drive.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder'
            },
            fields: 'id'
          });
          gFolderId = newFolder.data.id;
        }
  
        const gFilesRes = await drive.files.list({
          q: `'${gFolderId}' in parents and trashed=false`,
          fields: 'files(id, name, mimeType, size)',
          spaces: 'drive'
        });
  
        for (const f of gFilesRes.data.files) {
          const key = f.name;
          if (!allFilesMap.has(key)) {
            allFilesMap.set(key, {
              name: key,
              type: f.mimeType,
              size: f.size ? parseInt(f.size) : 0,
              sources: ['google']
            });
          } else {
            allFilesMap.get(key).sources.push('google');
          }
        }
      } catch (e) {
        console.error('Google Drive fetch error:', e.message);
      }
    }
  
    // access onedrive files
    if (req.user?.microsoft?.accessToken) {
      try {
        const msToken = req.user.microsoft.accessToken;
  
        const folderMeta = await axios.get(
          `https://graph.microsoft.com/v1.0/me/drive/root:/${folderName}`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
  
        const msFilesRes = await axios.get(
          `https://graph.microsoft.com/v1.0/me/drive/items/${folderMeta.data.id}/children`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
  
        for (const f of msFilesRes.data.value) {
          const key = f.name;
          if (!allFilesMap.has(key)) {
            allFilesMap.set(key, {
              name: key,
              type: f.file?.mimeType || 'folder',
              size: f.size,
              sources: ['microsoft']
            });
          } else {
            allFilesMap.get(key).sources.push('microsoft');
          }
        }
      } catch (e) {
        console.error('OneDrive fetch error:', e.message);
      }
    }
  
    // access dropbox files
    if (req.user?.dropbox?.accessToken) {
      try {
        const dbxRes = await axios.post('https://api.dropboxapi.com/2/files/list_folder', {
          path: `/File-Uploads`
        }, {
          headers: {
            Authorization: `Bearer ${req.user.dropbox.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
  
        for (const f of dbxRes.data.entries) {
          const key = f.name;
          if (!allFilesMap.has(key)) {
            allFilesMap.set(key, {
              name: key,
              type: f['.tag'],
              size: f.size,
              sources: ['dropbox']
            });
          } else {
            allFilesMap.get(key).sources.push('dropbox');
          }
        }
      } catch (e) {
        if (e.response?.status === 409) {
        } else {
          console.error('Dropbox fetch error:', e.message);
        }
      }
    }
  
    res.json(Array.from(allFilesMap.values()));
  });
  
  // handle file deletion
  app.delete('/delete', express.json(), async (req, res) => {
    if (!req.user) {
      return res.status(401).send('Not logged in');
    }
  
    const { filename } = req.body;
    if (!filename) return res.status(400).send('Filename required');
  
    const folderName = 'File-Uploads';
  
    // remove file from google drive
    if (req.user?.google) {
      try {
        const googleAuth = new google.auth.OAuth2();
        googleAuth.setCredentials({ access_token: req.user.google.accessToken });
        const drive = google.drive({ version: 'v3', auth: googleAuth });
  
        const gFileList = await drive.files.list({
          q: `name='${filename}' and trashed=false`,
          fields: 'files(id, name, parents)'
        });
  
        for (const file of gFileList.data.files) {
          await drive.files.delete({ fileId: file.id });
        }
      } catch (e) {
        console.error('Google Drive delete error:', e.message);
      }
    }
  
    // remove file from onedrive
    if (req.user?.microsoft) {
      try {
        const msToken = req.user.microsoft.accessToken;
  
        const folderMeta = await axios.get(
          `https://graph.microsoft.com/v1.0/me/drive/root:/${folderName}`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
  
        const msFilesRes = await axios.get(
          `https://graph.microsoft.com/v1.0/me/drive/items/${folderMeta.data.id}/children`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
  
        for (const f of msFilesRes.data.value) {
          if (f.name === filename) {
            await axios.delete(
              `https://graph.microsoft.com/v1.0/me/drive/items/${f.id}`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
          }
        }
      } catch (e) {
        console.error('OneDrive delete error:', e.message);
      }
    }
  
    // remove file from dropbox
    if (req.user?.dropbox) {
      try {
        await axios.post('https://api.dropboxapi.com/2/files/delete_v2', {
          path: `/File-Uploads/${filename}`
        }, {
          headers: {
            'Authorization': `Bearer ${req.user.dropbox.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e) {
        if (e.response?.status !== 409) {
          console.error('Dropbox delete error:', e.message);
        }
      }
    }
  
    res.send({ success: true });
  });  

app.listen(PORT, () => console.log('Server running...'));
