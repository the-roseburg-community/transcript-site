// audioHandler.js

let audioContext;
let mediaStream;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let audioProcessor;

// Function to start audio playback and detection
async function startPlayback(feedUrl) {
    if (!feedUrl) {
        alert('Please enter a valid Broadcastify feed URL.');
        return;
    }

    if (isRecording) {
        stopPlayback();
        return;
    }

    playButton.textContent = 'Stop';
    isRecording = true;

    try {
        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Fetch the audio stream using Fetch API and decode audio
        const response = await fetch(feedUrl);
        const audioBlob = await response.blob();
        const audioArrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
        
        // Create an audio source
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Create a gain node for controlling volume
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1; // Adjust volume

        // Create a script processor for audio analysis
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(audioProcessor);
        audioProcessor.connect(audioContext.destination);

        // Connect source to gain node and then to destination
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Event listener for audio processing
        audioProcessor.onaudioprocess = event => {
            const inputBuffer = event.inputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            const sum = inputData.reduce((acc, val) => acc + Math.abs(val), 0);

            // If audio is detected, start recording
            if (sum > 0.01 && mediaRecorder.state !== 'recording') {
                mediaRecorder.start();
            } else if (sum <= 0.01 && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        };

        // Create a media stream
        mediaStream = audioContext.createMediaStreamDestination();
        source.connect(mediaStream);
        mediaRecorder = new MediaRecorder(mediaStream.stream);

        // Event handler for data availability
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        // Event handler for stopping the recorder
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm; codecs=opus' });
            const audioUrl = URL.createObjectURL(audioBlob);
            addAudioToList(audioUrl);
            audioChunks = [];
        };

        // Play the audio
        source.start(0);

    } catch (error) {
        console.error('Error fetching or playing the audio feed:', error);
        alert('Failed to play the feed. Please check the URL or try another one.');
        stopPlayback();
    }
}

// Function to stop audio playback and detection
function stopPlayback() {
    playButton.textContent = 'Play';
    isRecording = false;
    mediaRecorder.stop();
    audioProcessor.disconnect();
    audioContext.close().catch(error => console.error('Error closing AudioContext:', error));
}

// Function to add recorded audio to the list
function addAudioToList(audioUrl) {
    const listItem = document.createElement('li');
    const audioElement = document.createElement('audio');
    const deleteButton = document.createElement('button');

    audioElement.src = audioUrl;
    audioElement.controls = true;

    deleteButton.textContent = 'Delete';
    deleteButton.onclick = () => listItem.remove();

    listItem.appendChild(audioElement);
    listItem.appendChild(deleteButton);
    audioList.appendChild(listItem);
}

