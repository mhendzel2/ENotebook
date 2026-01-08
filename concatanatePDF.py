import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pypdf import PdfWriter, PdfReader
import threading

class PDFCollatorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PDF Size Collator")
        self.root.geometry("600x500")  # Made slightly taller for the log
        
        # Variables
        self.source_dir = tk.StringVar()
        self.output_dir = tk.StringVar()
        self.target_size_str = tk.StringVar(value="150") 
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
        presets = ["10", "25", "50", "100", "150", "200", "500"]
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
                self.log("Invalid size format. Defaulting to 150MB.")
                target_bytes = 150.0 * 1024 * 1024
            
            self.log(f"Scanning {source_path}...")
            
            # 1. Get List of all PDFs
            all_files = [
                f for f in os.listdir(source_path) 
                if f.lower().endswith('.pdf')
            ]
            all_files.sort()
            
            if not all_files:
                self.log("No PDF files found in source directory.")
                self.finish_processing()
                return

            total_scan_count = len(all_files)
            
            # --- PHASE 1: FILTERING LOCKED FILES ---
            self.log("Phase 1: Scanning for locked/corrupt files...")
            
            valid_files = []
            excluded_files = []

            for i, filename in enumerate(all_files):
                file_path = os.path.join(source_path, filename)
                
                # Check if readable
                is_locked = False
                try:
                    reader = PdfReader(file_path)
                    if reader.is_encrypted:
                        # Try to read page count to see if we have access (sometimes pass is blank)
                        try:
                            _ = len(reader.pages)
                        except:
                            is_locked = True
                except Exception:
                    # If PdfReader crashes completely, the file is likely corrupt
                    is_locked = True

                if is_locked:
                    excluded_files.append(filename)
                    self.log(f" >> EXCLUDED: {filename} (Locked/Corrupt)")
                else:
                    valid_files.append(filename)

                # Progress update for scan
                if i % 5 == 0:
                     self.status_var.set(f"Scanning: {i+1}/{total_scan_count}...")

            # Report exclusion results
            if excluded_files:
                self.log(f"\n--- EXCLUSION REPORT ---")
                self.log(f"Skipped {len(excluded_files)} files (see above).")
                self.log(f"Proceeding with {len(valid_files)} valid files.")
                self.log(f"------------------------\n")
            else:
                self.log("Scan complete. All files are valid.\n")

            if not valid_files:
                self.log("Error: No valid files remaining to process.")
                messagebox.showerror("Error", "All files were excluded (locked or corrupt).")
                self.finish_processing()
                return

            # --- PHASE 2: PROCESSING & COLLATING ---
            self.log(f"Phase 2: Collating {len(valid_files)} files...")
            
            current_batch = []
            current_batch_size = 0
            batch_index = 1
            total_valid = len(valid_files)

            for i, filename in enumerate(valid_files):
                file_path = os.path.join(source_path, filename)
                try:
                    file_size = os.path.getsize(file_path)
                except OSError:
                    self.log(f"Skipping {filename}: Could not read file size.")
                    continue

                # Check if adding this file exceeds target (unless batch is empty)
                if current_batch and (current_batch_size + file_size > target_bytes):
                    self.write_batch(current_batch, output_path, batch_index)
                    batch_index += 1
                    current_batch = []
                    current_batch_size = 0

                current_batch.append(file_path)
                current_batch_size += file_size
                
                if i % 5 == 0:
                    self.status_var.set(f"Collating: {i+1}/{total_valid}...")

            # Write final batch
            if current_batch:
                self.write_batch(current_batch, output_path, batch_index)

            self.log("Done! Processing complete.")
            
            # Final Success Message with details
            msg = f"Completed!\n\nProcessed: {len(valid_files)} files"
            if excluded_files:
                msg += f"\nSkipped: {len(excluded_files)} files (Locked/Corrupt)"
                msg += "\n(Check log for list of skipped files)"
            
            messagebox.showinfo("Success", msg)

        except Exception as e:
            self.log(f"Error: {str(e)}")
            messagebox.showerror("Error", f"An error occurred: {str(e)}")
        
        finally:
            self.finish_processing()

    def write_batch(self, file_list, output_path, index):
        output_filename = f"Collated_Part_{index:03d}.pdf"
        full_output_path = os.path.join(output_path, output_filename)
        
        self.log(f"Writing {output_filename} ({len(file_list)} files)...")
        
        merger = PdfWriter()
        
        try:
            for pdf in file_list:
                merger.append(pdf)
            
            with open(full_output_path, "wb") as f_out:
                merger.write(f_out)
                
            merger.close()
            self.log(f"Saved: {output_filename}")
            
        except Exception as e:
            self.log(f"Failed to write {output_filename}: {str(e)}")

    def finish_processing(self):
        self.is_processing = False
        self.start_btn.config(state='normal')
        self.status_var.set("Ready")

if __name__ == "__main__":
    root = tk.Tk()
    app = PDFCollatorApp(root)
    root.mainloop()