# Smarter At‑Home Photo Printing

## Arrange multiple photos on a single page to avoid wasted paper when printing.

A simple HTML+JS+CSS solution that allows the user to arrange a collection of photos on a single (or multiple) page, to send to the printer. This reduces paper waste, and makes at-home printing of happy snaps a lot more convenient.

The goal here was to have a local and mobile friendly app that does not come with unnecesary bloat. This app lives in the browser, there is no backend and the photos never leaves your browser.

There are many apps and software out there that can do this, but they all come with extra unnecesary stuff, and often they are cloud based which is a privacy concern. Admittedly I did not search very hard for something suitable to my needs. I reckoned with the relative ease that comes with creating apps using AI assistants these days I could try and just create the app I want for myself. 

This is an example of what I like to call "home baked software" - it's not really intended for the world to use, I have no ambition of becoming the next unicorn, and have no interest in what other people do with this. It solves a problem that *I* have, and that's more than good enough.

### A note and disclaimer about AI Code / Vibe Coding / Agentic Engineering
This web-app was built using extensive help from an AI coding assistant. I'm not a decent programmer by any stretch of the imagination, and what skills I had is long rusted away. I do not have the time, energy or will to sit down and re-learn javascript just to spend multiple weekends to build something far less superior. The truth is that this would not exist without AI assistance, and I managed to get it out in mostly a couple of days. I'm excited about this new ability, and I look forward to my next home baked project, that will solve some other asinine little problem I have, all because I'm too lazy to search for something that already exists.

If you have a problem with my use of AI, then you are free to close this tab and go about your day.

### Dependencies

This app uses two third-party libraries for PDF export functionality:

- **jspdf** (v2.5.1) - Generates PDF documents client-side
- **html2canvas** (v1.4.1) - Renders HTML elements to canvas for PDF export

Both libraries are bundled locally in the `lib/` folder to ensure the app works fully offline without relying on external CDNs.

