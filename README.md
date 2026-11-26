# GV309 Week 9 – Four questions, opened one at a time

Students work in groups. Each question has its own page. You open the questions one at a
time from the instructor page, separately for each seminar (1, 2, 3 and 4). Students can
also send you questions, with their group's name or anonymously, and you answer them on
the instructor page.

## How the session runs

1. One student creates the group (seminar 1, 2, 3 or 4 and everyone's names). The site shows a
   six-digit code, which the others use to join on their own devices. Until you open a
   question, students see a waiting page.
2. You open a question on the instructor page. Students who are waiting are taken to it
   straight away. Students already working on another question see a notice at the bottom
   of the screen with a button to go to the new one, so nobody is pulled away mid-sentence.
3. Each question page sits at its own address (`/#q1`, `/#q2`, …), and the tabs at the top
   let students move between every question that is open.
4. Everyone in a group can type in the same box at the same time. Answers save as they
   type. Pasting is blocked (see below).

## Questions to the instructor

Students press **Ask the instructor** in the bar at the top of any page. A panel opens where
they pick what the question is about, type it, and press either **Send with our group's
name** or **Send anonymously**. Everyone in the group sees the group's questions and your
answers. A group can withdraw a question until you answer it.

On the instructor page, **Questions from students** lists the questions for the seminar you
are viewing, unanswered ones first. The seminar tabs show how many questions are waiting,
and so does the browser tab title, so you notice new ones while looking at something else.
For each question you can:

- **Send to [group] only**: the answer goes to the group that asked. This works for
  anonymous questions too; you never see which group it was.
- **Send to all of seminar N**: every group in that seminar sees the question and answer,
  with the asking group's name, or "asked anonymously".
- **Mark as answered in class**, if you answered it aloud.
- Edit an answer, switch it between the group and the whole seminar, or delete the question.

Students get a notice when an answer arrives. Anything you are typing is kept when new
questions come in. **Export student questions (CSV)** downloads all questions and answers.

About anonymity: the instructor page and the CSV never show which group sent an anonymous
question. The server still stores that link in its data file, because it needs it to send
your answer back to the right group.

## The table in question 1

**Question 1** is a table: one row per audience and one column per criterion. Each inner
cell is its own box. The cell for the ideal audience's coordination says "Not applicable"
and cannot be edited, as in the Word document, so there are 11 boxes to fill. On phones the
table turns into one card per audience, with the full column heading above each box.

## Instructor page

Go to `/instructor` and log in with the password you set (see deployment).

- Tabs for seminars 1 to 4. Each seminar has its own question settings, timer and student
  questions. A number on a tab shows unanswered questions in that seminar.
- Each question has three settings:
  - **Hidden**: students cannot see it. This is the setting for every question at the start.
  - **Open**: students can see it and write.
  - **Read-only**: students can read their answers but not change them. Useful when you
    move on but want them to keep the earlier answer in view.
  Hiding a question again keeps its answers; they reappear when you reopen it.
- Below each question you see how many groups have started it and how many devices are on
  its page. Question 1 has a button that starts a 25-minute timer; the general timer works
  for any length.
- The group table shows members (green dot = online), join codes, which page each device
  is on, progress per question (cells or parts filled, and words), and when the group last
  typed. "Last typed" turns amber after five minutes without typing while a question is open.
- **Answers** shows every group's answers live, one question at a time:
  - **Each group**: one table or one set of answers per group.
  - **Groups side by side**: for question 1, a single table with every group's answer in
    each cell; for the other questions, every group's answer under each part. This view
    works well for the discussion afterwards.
  The view does not redraw while you are selecting text, so you can copy from it.
- **Export answers (CSV)** downloads everything for all seminars (opens in Excel), one row
  per group and one column per cell or part.
- **Delete all data** clears all seminars, including student questions, and hides all
  questions again.

Students can press **Download our answers** at any time to save their group's work as a web
page (it opens in any browser and in Word).

## Changing the content

Edit `content.json`. The `seminars` list sets which seminar groups students can choose.
Each question has an `id`, a `title` (shown in the tabs once the
question is open) and either a `table` or a list of `parts`. Optional fields: `prompt`
(paragraphs above the answer boxes), `legend` (the numbered list of commitments in
question 1), `quote`, `minutes` (adds a timer button) and `wordLimit` (shows a word count
against a limit; the limit warns, it does not stop typing). `**bold**` and `*italic*` work
in question texts.

To make the "Not applicable" cell editable, delete the `"fixed"` entry in question 1.
`blockPaste` turns paste blocking on or off for the whole site.

Edit before class: renaming a cell or part `id` after students have written disconnects
their answers from that box.

## Deploying (same as previous weeks)

1. Upload the *contents* of this folder to a GitHub repository (or replace last week's
   files; export last week's CSV first, because last week's site and data go away).
2. On Render: New > Web Service > your repository. Build command `npm install`,
   start command `npm start`.
3. Under Environment, add `INSTRUCTOR_PASSWORD` with a password of your choice.
   Without it the password is `changeme`.
4. Put the Render URL in Moodle as a URL resource. The instructor page is the same URL
   followed by `/instructor`.

Data is saved in `data-week9.json` on the server. Free Render instances can lose this file
when they restart or redeploy, so export both CSV files at the end of each seminar. A free instance
also sleeps when unused; open the site a few minutes before class to wake it. After a
restart you need to log in to the instructor page again.

## Known limits

- Paste blocking stops ordinary pasting and drag-and-drop, but a determined student can
  get around it (for example with browser developer tools). It also stops students moving
  text between their own boxes by copy and paste.
- If a student types while offline, the text is sent when the connection returns. If the
  question was made read-only in the meantime, that offline text is discarded.
- Students rejoin automatically on the same browser. On another device they use the code.
