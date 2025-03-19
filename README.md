*To setup and run this project, follow the instructions below.*

1. **Clone the Repository**:
   ```bash
   $ git clone <repository_url>
   $ cd <project_folder>
   ```
   
2. **Install Dependencies**:
   ```bash
    $ yarn install
    ```

3. **Set Up the Database**:
    - Create a new database in [Supabase](https://supabase.io/).
    - Create a new collection in [Typesense](https://typesense.io/).
    - Create a new schema in the database and run the SQL script in the `database.sql` file to create the required tables.
    - Insert some data into the tables to test the application.



4. **Set Up Environment Variables**:
   Create a `.env` file in the root directory and add the required environment variables. For example:
   ```env
   SUPABASE_URL=<your_supabase_url>
   SUPABASE_KEY=<your_supabase_key>
   TYPESENSE_HOST=<your_typesense_host>
   TYPESENSE_PORT=<your_typesense_port>
   TYPESENSE_PROTOCOL=<http_or_https>
   TYPESENSE_API_KEY=<your_typesense_api_key>
   ```

5. **Run the Backend Application**:
   ```bash
   # Start the application in development mode
   $ yarn run start:dev
   ```

   The application will start on the default port `3001` unless a different port is specified in the `.env` file.

6. **Access the Application**:
   Open your browser or API client and navigate to `http://localhost:3001` to access the backend.

Ensure the recipient has Node.js and Yarn installed on their system before running the project.

