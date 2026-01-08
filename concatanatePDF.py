import os
import sys
import argparse
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import threading

try:
    from pypdf import PdfWriter, PdfReader
except ModuleNotFoundError as e:
    missing_module = getattr(e, "name", "pypdf")
    if missing_module == "pypdf":
        help_text = (
            "Missing dependency: pypdf\n\n"
            "Install it with:\n"
            "  python -m pip install pypdf\n\n"
            "Important: run that using the same Python you use to start this script."
        )
        try:
            messagebox.showerror("PDF Collator - Missing Dependency", help_text)
        except Exception:
            print(help_text)
        raise SystemExit(1)
    raise


def _write_batch(file_list, output_path, index, log):
    output_filename = f"Collated_Part_{index:03d}.pdf"
    full_output_path = os.path.join(output_path, output_filename)

    log(f"Writing {output_filename} ({len(file_list)} files)...")
    merger = PdfWriter()
    try:
        for pdf in file_list:
            try:
                merger.append(pdf, import_outline=False)
            except Exception as e:
                log(f" >> SKIP (append failed): {os.path.basename(pdf)} ({e})")

        with open(full_output_path, "wb") as f_out:
            merger.write(f_out)
        log(f"Saved: {output_filename}")
    finally:
        try:
            merger.close()
        except Exception:
            pass


def collate_pdfs(source_path, output_path, target_bytes, log, status=None):
    if not os.path.isdir(source_path):
        raise ValueError(f"Source folder does not exist: {source_path}")
    if not os.path.isdir(output_path):
        raise ValueError(f"Output folder does not exist: {output_path}")

    log(f"Scanning {source_path}...")

    all_files = [f for f in os.listdir(source_path) if f.lower().endswith(".pdf")]
    all_files.sort()
    if not all_files:
        raise ValueError("No PDF files found in source directory.")

    total_scan_count = len(all_files)

    log("Phase 1: Scanning for locked/corrupt files...")
    valid_files = []
    excluded_files = []

    for i, filename in enumerate(all_files):
        file_path = os.path.join(source_path, filename)

        is_locked = False
        try:
            reader = PdfReader(file_path)
            if reader.is_encrypted:
                try:
                    _ = len(reader.pages)
                except Exception:
                    is_locked = True
        except Exception:
            is_locked = True

        if is_locked:
            excluded_files.append(filename)
            log(f" >> EXCLUDED: {filename} (Locked/Corrupt)")
        else:
            valid_files.append(filename)

        if status and i % 5 == 0:
            status(f"Scanning: {i + 1}/{total_scan_count}...")

    if excluded_files:
        log("\n--- EXCLUSION REPORT ---")
        log(f"Skipped {len(excluded_files)} files (see above).")
        log(f"Proceeding with {len(valid_files)} valid files.")
        log("------------------------\n")
    else:
        log("Scan complete. All files are valid.\n")

    if not valid_files:
        raise ValueError("All files were excluded (locked or corrupt).")

    log(f"Phase 2: Collating {len(valid_files)} files...")

    current_batch = []
    current_batch_size = 0
    batch_index = 1
    total_valid = len(valid_files)

    for i, filename in enumerate(valid_files):
        file_path = os.path.join(source_path, filename)
        try:
            file_size = os.path.getsize(file_path)
        except OSError:
            log(f"Skipping {filename}: Could not read file size.")
            continue

        if current_batch and (current_batch_size + file_size > target_bytes):
            _write_batch(current_batch, output_path, batch_index, log)
            batch_index += 1
            current_batch = []
            current_batch_size = 0

        current_batch.append(file_path)
        current_batch_size += file_size

        if status and i % 5 == 0:
            status(f"Collating: {i + 1}/{total_valid}...")

    if current_batch:
        _write_batch(current_batch, output_path, batch_index, log)

    return {
        "processed": len(valid_files),
        "skipped": len(excluded_files),
        "skipped_files": excluded_files,
        "batches": batch_index,
    }

class PDFCollatorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PDF Size Collator")
        self.root.geometry("600x500")  # Made slightly taller for the log
        
        # Variables
        self.source_dir = tk.StringVar()
        self.output_dir = tk.StringVar()
        self.target_size_str = tk.StringVar(value="80")
        self.status_var = tk.StringVar(value="Ready")
        self.is_processing = False

        self._create_ui()

    def _create_ui(self):
        # Main container
        main_frame = ttk.Frame(self.root, padding="20")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Source Selection
        ttk.Label(main_frame, text="Source Folder (containing PDFs):").grid(row=0, column=0, sticky="w", pady=5)
        src_entry = ttk.Entry(main_frame, textvariable=self.source_dir, width=50)
        src_entry.grid(row=1, column=0, sticky="ew", pady=5)
        ttk.Button(main_frame, text="Browse...", command=self.select_source).grid(row=1, column=1, padx=5)

        # Output Selection
        ttk.Label(main_frame, text="Output Folder (for combined files):").grid(row=2, column=0, sticky="w", pady=5)
        out_entry = ttk.Entry(main_frame, textvariable=self.output_dir, width=50)
        out_entry.grid(row=3, column=0, sticky="ew", pady=5)
        ttk.Button(main_frame, text="Browse...", command=self.select_output).grid(row=3, column=1, padx=5)

        # Size Settings
        settings_frame = ttk.LabelFrame(main_frame, text="Settings", padding="10")
        settings_frame.grid(row=4, column=0, columnspan=2, sticky="ew", pady=20)
        
        ttk.Label(settings_frame, text="Max File Size (MB):").pack(side=tk.LEFT, padx=5)
        
        # Presets
        presets = ["10", "25", "50", "80", "100", "150", "200", "500"]
        size_combo = ttk.Combobox(settings_frame, textvariable=self.target_size_str, values=presets, width=10)
        size_combo.pack(side=tk.LEFT, padx=5)

        ttk.Label(settings_frame, text="(Approximate split point)").pack(side=tk.LEFT, padx=5)

        # Log Area
        self.log_text = tk.Text(main_frame, height=12, width=60, state='disabled', font=("Consolas", 9))
        self.log_text.grid(row=5, column=0, columnspan=2, pady=10, sticky="nsew")
        
        # Scrollbar for log
        scrollbar = ttk.Scrollbar(main_frame, orient="vertical", command=self.log_text.yview)
        scrollbar.grid(row=5, column=2, sticky="ns")
        self.log_text['yscrollcommand'] = scrollbar.set

        # Actions
        btn_frame = ttk.Frame(main_frame)
        btn_frame.grid(row=6, column=0, columnspan=3, pady=10)
        
        self.start_btn = ttk.Button(btn_frame, text="Start Processing", command=self.start_processing_thread)
        self.start_btn.pack(side=tk.LEFT, padx=10)
        
        ttk.Button(btn_frame, text="Close", command=self.root.destroy).pack(side=tk.LEFT, padx=10)

        # Status Bar
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def select_source(self):
        path = filedialog.askdirectory()
        if path:
            self.source_dir.set(path)

    def select_output(self):
        path = filedialog.askdirectory()
        if path:
            self.output_dir.set(path)

    def log(self, message):
        self.log_text.config(state='normal')
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.log_text.config(state='disabled')

    def start_processing_thread(self):
        if self.is_processing:
            return
        
        source = self.source_dir.get()
        output = self.output_dir.get()
        
        if not source or not output:
            messagebox.showerror("Error", "Please select both source and output folders.")
            return

        try:
            float(self.target_size_str.get())
        except ValueError:
            messagebox.showerror("Error", "Please enter a valid number for the file size.")
            return

        self.is_processing = True
        self.start_btn.config(state='disabled')
        self.log_text.config(state='normal')
        self.log_text.delete(1.0, tk.END)
        self.log_text.config(state='disabled')
        
        thread = threading.Thread(target=self.process_pdfs)
        thread.daemon = True
        thread.start()

    def process_pdfs(self):
        try:
            source_path = self.source_dir.get()
            output_path = self.output_dir.get()
            
            try:
                size_mb = float(self.target_size_str.get())
                target_bytes = size_mb * 1024 * 1024
            except ValueError:
                self.log("Invalid size format. Defaulting to 80MB.")
                target_bytes = 80.0 * 1024 * 1024
            
            result = collate_pdfs(
                source_path=source_path,
                output_path=output_path,
                target_bytes=target_bytes,
                log=self.log,
                status=self.status_var.set,
            )

            self.log("Done! Processing complete.")

            msg = f"Completed!\n\nProcessed: {result['processed']} files"
            if result["skipped"]:
                msg += f"\nSkipped: {result['skipped']} files (Locked/Corrupt)"
                msg += "\n(Check log for list of skipped files)"

            messagebox.showinfo("Success", msg)

        except Exception as e:
            self.log(f"Error: {str(e)}")
            messagebox.showerror("Error", f"An error occurred: {str(e)}")
        
        finally:
            self.finish_processing()

    def write_batch(self, file_list, output_path, index):
        try:
            _write_batch(file_list, output_path, index, self.log)
        except Exception as e:
            self.log(f"Failed to write Collated_Part_{index:03d}.pdf: {str(e)}")

    def finish_processing(self):
        self.is_processing = False
        self.start_btn.config(state='normal')
        self.status_var.set("Ready")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collate PDFs into batches by approximate max size.")
    parser.add_argument("--source", help="Source folder containing PDFs")
    parser.add_argument("--output", help="Output folder for collated PDFs")
    parser.add_argument("--size-mb", type=float, default=80.0, help="Max output file size in MB (approximate)")
    args = parser.parse_args()

    if args.source and args.output:
        target_bytes = args.size_mb * 1024 * 1024
        try:
            result = collate_pdfs(
                source_path=args.source,
                output_path=args.output,
                target_bytes=target_bytes,
                log=print,
                status=lambda s: None,
            )
            print("Done! Processing complete.")
            print(f"Processed: {result['processed']} files")
            if result["skipped"]:
                print(f"Skipped: {result['skipped']} locked/corrupt files")
            raise SystemExit(0)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            raise SystemExit(1)

    root = tk.Tk()
    app = PDFCollatorApp(root)
    root.mainloop()