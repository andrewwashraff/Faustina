# Interactive Lyrics Player — For Faustina

A responsive, mobile-friendly interactive song page with synchronized, clickable lyrics.

## Replace the cover
Replace `assets/cover.jpg` with your final photo using the exact same filename. If you prefer PNG, change `cover` in `song-data.js` to `assets/cover.png` and upload that file.

## Main files
- `index.html` — page structure
- `styles.css` — responsive styling + dark/light mode
- `app.js` — player, lyrics, sharing, download, and theme behavior
- `song-data.js` — song metadata and lyric timings
- `assets/song.mp3` — audio file
- `assets/cover.jpg` — cover image

## Editing lyric timings
The timing editor is hidden from the normal gift page. To open it, add `?edit=1` to your published URL.

Example:
`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/?edit=1`

Play the song and press **Mark & next** when each selected lyric starts. When finished, choose **Download song-data.js** and replace the old `song-data.js` in your GitHub repository.

## MP3 download
The page includes a **Download MP3** option. The file downloaded is `For-Faustina.mp3`.
