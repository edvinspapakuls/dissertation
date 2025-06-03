import React, { useEffect, useState } from 'react';
import axios from 'axios';
import "./App.css"

function App() {
  // manage state of each variable
const [auth, setAuth] = useState({ google: false, microsoft: false, dropbox: false });
const [file, setFile] = useState(null);
const [files, setFiles] = useState([]);
const [targets, setTargets] = useState({
  google: false,
  microsoft: false,
  dropbox: false
});
const [error, setError] = useState('');
const [success, setSuccess] = useState('');

// check if user has logged in the cloud services
useEffect(() => {
  axios.get('http://localhost:5000/me', { withCredentials: true })
    .then(res => setAuth(res.data))
    .catch(() => setAuth({ google: false, microsoft: false, dropbox: false }));
  fetchFiles();
}, []);  

// handle error message
const showError = (msg) => {
  setError(msg);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => setError(''), 4000);
};

// handle success messages
const showSuccess = (msg) => {
  setSuccess(msg);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => setSuccess(''), 4000);
};

//upload file to nodejs backend
const handleUpload = async () => {
  setError('');

  if (!file) {
    showError('Please select a file to upload.');
    return;
  }

  const selectedTargets = Object.entries(targets).filter(([_, v]) => v);
  if (selectedTargets.length === 0) {
    showError('Please select at least one cloud service.');
    return;
  }

  const unauthTargets = selectedTargets.filter(([drive]) => !auth[drive]);
  if (unauthTargets.length > 0) {
    const driveNames = unauthTargets.map(([d]) => {
      if (d === 'google') return 'Google Drive';
      if (d === 'microsoft') return 'OneDrive';
      if (d === 'dropbox') return 'Dropbox';
      return d;
    }).join(', ');
    showError(`You are not logged into: ${driveNames}.`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('targets', JSON.stringify(targets));

  try {
    await axios.post('http://localhost:5000/upload', formData, {
      withCredentials: true
    });
    await fetchFiles();
    showSuccess('File uploaded successfully.');
    setError('');
  } catch (err) {
    console.error(err);
    showError('Upload failed. Please try again.');
  }
};

// fetch and display uplaoded files
const fetchFiles = async () => {
  try {
    const res = await axios.get('http://localhost:5000/files', { withCredentials: true });
    setFiles(res.data);
  } catch (err) {
    console.error(err);
    setError('Could not fetch files. Make sure you are logged in.');
  }
};  

// handle file deletion
const handleDelete = async (filename) => {
  try {
    await axios.delete('http://localhost:5000/delete', {
      data: { filename },
      withCredentials: true
    });
    showSuccess(`${filename} deleted successfully.`);
    fetchFiles();
  } catch (err) {
    alert('Delete failed');
    console.error(err);
  }
};

//logout user by removing the state of saved tokens
const handleFrontendLogout = () => {
  setAuth({ google: false, microsoft: false, dropbox: false });
  setTargets({ google: false, microsoft: false, dropbox: false });
  setFiles([]);
  showSuccess('Logged out on frontend.');
};

return (
  <div className="App">

    {error && (
      <div className="error-popup">{error}</div>
    )}
    {success && (
      <div className="success-popup">{success}</div>
    )}

    <h1>DriveUp</h1>

    {!auth.google || !auth.microsoft || !auth.dropbox ? (
      <div className="section login-buttons">
        {!auth.google && (
          <a href="http://ec2-18-171-178-88.eu-west-2.compute.amazonaws.com:5000/auth/google" className="button">
            Login with Google
          </a>
        )}
        {!auth.microsoft && (
          <a href="http://localhost:5000/auth/microsoft" className="button">
            Login with Microsoft
          </a>
        )}
        {!auth.dropbox && (
          <a href="http://localhost:5000/auth/dropbox" className="button">
            Login with Dropbox
          </a>
        )}
      </div>
    ) : null}

    {(auth.google || auth.microsoft || auth.dropbox) && (
      <>
        <div className="section checkbox-group">
          {auth.google && (
            <label>
              <input
                type="checkbox"
                checked={targets.google}
                onChange={() => setTargets(t => ({ ...t, google: !t.google }))}
              />
              Google Drive
            </label>
          )}
          {auth.microsoft && (
            <label>
              <input
                type="checkbox"
                checked={targets.microsoft}
                onChange={() => setTargets(t => ({ ...t, microsoft: !t.microsoft }))}
              />
              OneDrive
            </label>
          )}
          {auth.dropbox && (
            <label>
              <input
                type="checkbox"
                checked={targets.dropbox}
                onChange={() => setTargets(t => ({ ...t, dropbox: !t.dropbox }))}
              />
              Dropbox
            </label>
          )}
        {(auth.google || auth.microsoft || auth.dropbox) && (
        <button className="button" onClick={handleFrontendLogout}>Logout</button>
        )}
        </div>

        <div className="section">
          <input type="file" onChange={e => setFile(e.target.files[0])} />
          <button className="button" onClick={handleUpload}>
            Upload
          </button>
        </div>

        <div className="section">
          <h2>Files Present on Drives</h2>
          <div className="file-list">
            {files.map((f, idx) => (
              <div className="file-item" key={idx}>
                <div className="file-item-title">{f.name}</div>
                <div className="file-item-details">
                  {f.type}, {f.size} bytes, stored on: {f.sources.join(', ')}
                </div>
                <button onClick={() => handleDelete(f.name)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      </>
    )}
  </div>
);

}

export default App;
