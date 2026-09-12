---
title: Why I built ambercast
description: The story of how I went from hating manual click-through testing to turning AI-driven click-through testing into an asset.
---

I build software on my own. Before every release, I do a click-through test: touching every feature by hand to make sure it still works. I hated this. The more screens a product has, the longer it takes, and it is the same work every time.

Then Playwright MCP arrived, and I could hand this work to AI. I ask Claude Code to sign in, register some data, and check the numbers on a dashboard, and it opens a browser and actually does it. Full pre-release checks became something AI clicked through for me.

## Traditional E2E tests kept breaking {#e2e-broke}

Around the same time, my development work had become mostly an AI loop: hand over a spec, let AI implement it, run the tests, fix what fails. Traditional E2E tests written in Playwright could not keep up with that pace.

AI changes the UI freely: button positions, labels, DOM structure. Every change broke a selector and turned a test red. I let AI fix those too, but E2E repairs were never a one-shot job. Fix, run, and something else breaks. That loop ate time and tokens, and testing became the bottleneck on how fast I could implement.

Meanwhile, the tests I had AI click through by hand never broke that way. AI looks at the screen and finds the sign-in button, so it does not care that a selector changed.

That is when it occurred to me: if I could turn AI-driven click-through testing into an asset, I could shrink traditional E2E testing considerably.

## But having AI click through every time is not an asset {#not-an-asset}

Once I tried it, a different problem showed up.

- I had to retype the prompt every time, and I could not even remember what I had asked for last time
- Every run started from scratch, exploring the product's features again, because AI had forgotten what it learned before
- It took time and burned tokens, which added up once every feature was in scope
- The same instructions produced different results from run to run

It did not break easily, but it had no repeatability. It was cheap, but it never accumulated. This was not an asset. It was work I redid every time.

## Intent stays as text, execution stays as a plan {#intent-and-plan}

While researching how to build this tool, I came across the observation that AI-driven testing has a repeatability problem. That is when I thought of a SQL query plan.

SQL lets you write what you want, and the database builds a query plan for how to get it. The plan gets reused, and rebuilt when the tables change. Nobody writes the plan by hand.

A test can take the same shape. You write what you want to verify in natural language. AI reads it once and builds a plan. The first run learns how each step maps to the screen, and from the second time on, it just replays that plan as long as those records still hit. AI is not called. Only when the UI changes enough that the plan no longer matches does AI fix the plan or the records, and a human approves the fix.

Intent stays fixed in amber as text; execution is cast from that mold as many times as needed. That is where the name ambercast comes from.

## Who this is for {#who-for}

I am an engineer, so I built this for myself first. But I also want people known as vibe coders to see the value of tests. The more you let AI write your code, the more you need a way to notice what AI has broken. When a test is natural language, you can read it, write it, and have AI fix it.

[The next page, Philosophy, explains the thinking behind this answer.](/ambercast/philosophy/)
