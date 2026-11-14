/*
 * Quran.com API v4 client (https://api-docs.quran.com). Public, read-only,
 * no key needed. Every successful response is cached in localStorage so the
 * catalog still loads when the API is slow or unreachable.
 */
namespace Quraan {
  const API_BASE = "https://api.quran.com/api/v4/";
  const CACHE_PREFIX = "quraan.api.v4:";
  const REQUEST_TIMEOUT_MS = 10000;

  export interface Surah {
    number: number;
    name: string;
    arabic: string;
    meaning: string;
    verses: number;
  }

  export interface Reciter {
    id: number;
    name: string;
    style: string;
  }

  interface ChaptersResponse {
    chapters: {
      id: number;
      name_simple: string;
      name_arabic: string;
      verses_count: number;
      translated_name: { name: string };
    }[];
  }

  interface ChapterRecitersResponse {
    reciters: {
      id: number;
      name: string;
      style?: { name: string } | null;
      translated_name?: { name: string } | null;
    }[];
  }

  interface ChapterRecitationsResponse {
    audio_files: { chapter_id: number; audio_url: string }[];
  }

  export function fetchSurahs(): Promise<Surah[]> {
    return getJson<ChaptersResponse>("chapters?language=en").then(function (res) {
      return res.chapters.map(function (c): Surah {
        return {
          number: c.id,
          name: c.name_simple,
          arabic: c.name_arabic,
          meaning: c.translated_name.name,
          verses: c.verses_count
        };
      });
    });
  }

  export function fetchReciters(): Promise<Reciter[]> {
    return getJson<ChapterRecitersResponse>("resources/chapter_reciters?language=en").then(function (res) {
      return res.reciters.map(function (r): Reciter {
        return {
          id: r.id,
          name: (r.translated_name && r.translated_name.name) || r.name,
          style: (r.style && r.style.name) || ""
        };
      }).sort(function (a, b) {
        return a.name.localeCompare(b.name) || a.style.localeCompare(b.style);
      });
    });
  }

  const audioUrlsByReciter: { [reciterId: number]: Promise<{ [chapter: number]: string }> } = {};

  /** Resolves the MP3 URL of a whole surah for a reciter (one API call per reciter). */
  export function fetchAudioUrl(reciterId: number, surahNumber: number): Promise<string> {
    let urls = audioUrlsByReciter[reciterId];
    if (!urls) {
      urls = getJson<ChapterRecitationsResponse>("chapter_recitations/" + reciterId).then(function (res) {
        const byChapter: { [chapter: number]: string } = {};
        for (let i = 0; i < res.audio_files.length; i++) {
          byChapter[res.audio_files[i].chapter_id] = res.audio_files[i].audio_url;
        }
        return byChapter;
      });
      audioUrlsByReciter[reciterId] = urls;
      urls.then(null, function () { delete audioUrlsByReciter[reciterId]; });
    }
    return urls.then(function (byChapter) {
      const url = byChapter[surahNumber];
      if (!url) { throw new Error("No audio for surah " + surahNumber + " by reciter " + reciterId); }
      return url;
    });
  }

  function getJson<T>(path: string): Promise<T> {
    return request(API_BASE + path).then(function (body) {
      const data = JSON.parse(body) as T;
      writeCache(path, body);
      return data;
    }).then(null, function (err: unknown) {
      const cached = readCache(path);
      if (cached) { return JSON.parse(cached) as T; }
      throw err;
    });
  }

  function request(url: string): Promise<string> {
    return new Promise<string>(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.setRequestHeader("Accept", "application/json");
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error("HTTP " + xhr.status + " for " + url));
        }
      };
      xhr.onerror = function () { reject(new Error("Network error for " + url)); };
      xhr.ontimeout = function () { reject(new Error("Timed out: " + url)); };
      xhr.send();
    });
  }

  function readCache(path: string): string | null {
    try { return localStorage.getItem(CACHE_PREFIX + path); } catch (e) { return null; }
  }

  function writeCache(path: string, body: string): void {
    try { localStorage.setItem(CACHE_PREFIX + path, body); } catch (e) { /* storage full or unavailable */ }
  }
}
