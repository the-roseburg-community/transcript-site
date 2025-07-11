const darkModeToggle = document.getElementById('darkModeToggle');
const body = document.body;
darkModeToggle.addEventListener('change', () => {
    if (darkModeToggle.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'enabled');
    } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'disabled');
    }
});
if (localStorage.getItem('darkMode') === 'enabled') {
    darkModeToggle.checked = true;
    body.classList.add('dark-mode');
}

const keywordsRed = [
    "commercial fire", "cover fire", "flue fire", "structure fire", "urgent", "smoke",
    "accident", "grass fire", "burn", "vehicle fire", "mva", "nva ", "mba ", "explosion", "gunshot"
];
const keywordsYellow = [
    "medical aid", "mutual aid", "flood", "power outage", "road closure", "water rescue"
];
const keywordsOrange = [
    "fire alarm", "fire investigation"
];

async function getDateUrls() {
    const now = new Date();
    // Today in UTC
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    // Yesterday in UTC
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yYear = yesterday.getUTCFullYear();
    const yMonth = yesterday.getUTCMonth() + 1;
    const yDay = yesterday.getUTCDate();
    return [
        `https://archive.theroseburgreceiver.com/law1/${year}/${month}/${day}/`,
        `https://archive.theroseburgreceiver.com/law1/${yYear}/${yMonth}/${yDay}/`
    ];
}

function getDateFromFilename(filename) {
    // Expects format: call_YYYYMMDD_HHMMSS.json
    try {
        const parts = filename.replace('.json', '').split('_');
        if (parts.length < 3) return null;
        const y = parseInt(parts[1].slice(0,4), 10);
        const m = parseInt(parts[1].slice(4,6), 10);
        const d = parseInt(parts[1].slice(6,8), 10);
        const hh = parseInt(parts[2].slice(0,2), 10);
        const mm = parseInt(parts[2].slice(2,4), 10);
        const ss = parseInt(parts[2].slice(4,6), 10);
        return new Date(Date.UTC(y, m-1, d, hh, mm, ss));
    } catch {
        return null;
    }
}

async function fetchTranscripts() {
    const baseUrls = await getDateUrls();
    let fileList = [];

    for (const baseUrl of baseUrls) {
        try {
            const response = await fetch(baseUrl);
            if (!response.ok) continue;
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const links = Array.from(doc.querySelectorAll('a'))
                .map(a => a.getAttribute('href'))
                .filter(href => href && href.endsWith('.json'))
                .map(href => {
                    const fullUrl = baseUrl + href;
                    return {
                        url: fullUrl,
                        filename: href
                    };
                });
            fileList = fileList.concat(links);
        } catch {
            continue;
        }
    }

    // Sort by the parsed date from filename, newest first
    fileList = fileList.filter(f => getDateFromFilename(f.filename))
        .sort((a, b) => {
            const dateA = getDateFromFilename(a.filename);
            const dateB = getDateFromFilename(b.filename);
            return dateB - dateA; // Descending (newest first)
        })
        .slice(0, 50);

    const transcripts = [];
    for (const file of fileList) {
        try {
            const response = await fetch(file.url);
            if (!response.ok) continue;
            const json = await response.json();
            let transcript = json.transcript?.transcript || 'No transcript available';
            const regex = /Thanks\s*for\s*watching|Thank\s*you\s*for\s*watching/gi;
            if (regex.test(transcript)) {
                transcript = "-- FIRE TONE OR NO AUDIO --";
            }
            const filename = file.filename;
            const dateStr = filename.split('_')[1];
            const year = dateStr.slice(0, 4);
            const month = dateStr.slice(4, 6);
            const day = dateStr.slice(6, 8);
            const timeStr = filename.split('_')[2].slice(0, 6);
            const hours = timeStr.slice(0, 2);
            const minutes = timeStr.slice(2, 4);
            const seconds = timeStr.slice(4, 6);
            const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
            const losAngelesTime = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(utcDate);

            const baseUrl = file.url.substring(0, file.url.lastIndexOf('/') + 1);
            const mp3Link = `${baseUrl}${filename.replace('.json', '.mp3')}`;
            const matchingRedKeyword = keywordsRed.find(keyword => transcript.toLowerCase().includes(keyword.toLowerCase()));
            const matchingYellowKeyword = keywordsYellow.find(keyword => transcript.toLowerCase().includes(keyword.toLowerCase()));
            const matchingOrangeKeyword = keywordsOrange.find(keyword => transcript.toLowerCase().includes(keyword.toLowerCase()));

            if (matchingRedKeyword) {
                transcript = transcript.replace(
                    new RegExp(`(${matchingRedKeyword})`, 'gi'),
                    '<span class="keyword-red">$1</span>'
                );
            }
            if (matchingYellowKeyword) {
                transcript = transcript.replace(
                    new RegExp(`(${matchingYellowKeyword})`, 'gi'),
                    '<span class="keyword-yellow">$1</span>'
                );
            }
            if (matchingOrangeKeyword) {
                transcript = transcript.replace(
                    new RegExp(`(${matchingOrangeKeyword})`, 'gi'),
                    '<span class="keyword-orange">$1</span>'
                );
            }

            transcripts.push({ time: losAngelesTime, transcript, mp3Link, matchingRedKeyword, matchingYellowKeyword, matchingOrangeKeyword });
        } catch (error) {
            continue;
        }
    }
    displayTranscripts(transcripts);
}

function displayTranscripts(transcripts) {
    const transcriptsContainer = document.getElementById('transcripts');
    const audioPlayer = document.getElementById('audioPlayer');
    const audioSource = document.getElementById('audioSource');
    transcriptsContainer.innerHTML = '';
    transcripts.forEach(({ time, transcript, mp3Link, matchingRedKeyword, matchingYellowKeyword, matchingOrangeKeyword }) => {
        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'transcript';
        if (matchingRedKeyword) {
            transcriptDiv.classList.add('highlight-red');
        } else if (matchingYellowKeyword) {
            transcriptDiv.classList.add('highlight-yellow');
        } else if (matchingOrangeKeyword) {
            transcriptDiv.classList.add('highlight-orange');
        }
        const timeSpan = document.createElement('span');
        timeSpan.style.fontWeight = 'bold';
        timeSpan.textContent = `${time}: `;
        transcriptDiv.appendChild(timeSpan);
        const transcriptSpan = document.createElement('span');
        transcriptSpan.innerHTML = transcript;
        transcriptDiv.appendChild(transcriptSpan);

        const mp3LinkAnchor = document.createElement('a');
        mp3LinkAnchor.href = '#';
        mp3LinkAnchor.textContent = '▶ Listen';
        mp3LinkAnchor.className = 'listen-btn';
        mp3LinkAnchor.addEventListener('click', (event) => {
            event.preventDefault();
            audioSource.src = mp3Link;
            audioPlayer.load();
            audioPlayer.play();
        });
        transcriptDiv.appendChild(mp3LinkAnchor);

        const copyIcon = document.createElement('span');
        copyIcon.textContent = '📋';
        copyIcon.className = 'copy-icon';

        const tooltip = document.createElement('span');
        tooltip.className = 'tooltip';
        tooltip.textContent = 'Copied!';
        copyIcon.appendChild(tooltip);

        copyIcon.addEventListener('click', () => {
            navigator.clipboard.writeText(transcript.replace(/<[^>]+>/g, ''))
                .then(() => {
                    tooltip.style.visibility = 'visible';
                    tooltip.style.opacity = '1';
                    setTimeout(() => {
                        tooltip.style.visibility = 'hidden';
                        tooltip.style.opacity = '0';
                    }, 2000);
                })
                .catch(err => console.error('Error copying text:', err));
        });
        transcriptDiv.appendChild(copyIcon);

        transcriptsContainer.appendChild(transcriptDiv);
    });
}

fetchTranscripts();
setInterval(fetchTranscripts, 5000);

