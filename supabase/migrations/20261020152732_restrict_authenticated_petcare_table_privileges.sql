REVOKE ALL PRIVILEGES ON TABLE public.petcare_data, public.pets FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.petcare_data, public.pets TO authenticated;
