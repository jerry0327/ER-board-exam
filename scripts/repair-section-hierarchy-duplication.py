from pathlib import Path

path = Path("app/components/audio-section-companion.tsx")
text = path.read_text()

stale_tail = '''        </ol>
                )}
              </li>
            );
          })}
        </ol>
                )}
              </li>
            );
          })}
        </ol>
      </section>,'''
clean_tail = '''        </ol>
      </section>,'''

if stale_tail in text:
    text = text.replace(stale_tail, clean_tail, 1)
elif text.count('className="audio-section-list-l2') >= 1:
    print("Section hierarchy JSX is already clean.")
else:
    raise SystemExit("Expected Section hierarchy JSX was not found")

path.write_text(text)
