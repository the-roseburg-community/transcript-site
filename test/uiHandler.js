// uiHandler.js

const feedUrlInput = document.getElementById('feedUrl');
const playButton = document.getElementById('playButton');
const audioList = document.getElementById('audioList');

// Event listener for the play button
playButton.addEventListener('click', () => {
    const feedUrl = feedUrlInput.value;
    if (isRecording) {
        stopPlayback();
    } else {
        startPlayback(feedUrl);
    }
});

