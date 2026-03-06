# Photo Collage Printer

The Photo Collage Printer (PCP) is a web-app that will allow the user to prepare one or more pages filled with photos for printing on a home desktop printer. 

Often, when wanting to print photos at home, the only options are to print the picture full-page. Built in print utilities are not powerful enough to give the user the ability to arrange photos on the page to print the size they want, and not waste paper in the process. So the current solution is to use something like Word, import the images, crop, rotate and arrange them and then send the document to print.

I would like to be able to do this without needing to use MS word. I want to be able to do it from any device, including mobile, tablet and laptop, and then use my device's built-in print utility to send the prepared document to the printer.

## Functional Requirements

### Document Management
- The application should launch with a single blank page, similar to how MS Word launches. 
- The default page size should be A4
- I should be able to change the size of the page
- I should be able to add and remove pages

### Photo Management
- I should be able to import images into a page using my device's built-in file picker
- I should be able to rotate a photo once it's imported
- I should be able to crop a photo once it's imported
- I should be able to remove a photo from the page
- I should be able to define a fixed size in mm or cm, for the photo, once it's imported
- I should be able to add as many photos to a page as I want, even if they overlap one-another.
- I should be able to remove photos from a page

## Non-functional requirements
- The web-app should be in the browser only, with no backend service. 
- The web-app must be deployable on something like GitHub Pages or similar, or even from a local machine